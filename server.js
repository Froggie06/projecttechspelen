require("dotenv").config()

const xss = require("xss")
const express = require("express")
const { MongoClient, ObjectId } = require("mongodb")
const session = require("express-session")
const bcrypt = require("bcrypt")
const multer = require("multer")
const path = require("path")
const fs = require("fs")

const app = express()
const port = Number(process.env.PORT) || 3000

const uri = process.env.MONGODB_URI
const client = new MongoClient(uri)

const provinces = [
  "Drenthe",
  "Flevoland",
  "Friesland",
  "Gelderland",
  "Groningen",
  "Limburg",
  "Noord-Brabant",
  "Noord-Holland",
  "Overijssel",
  "Utrecht",
  "Zeeland",
  "Zuid-Holland",
]

app.set("view engine", "ejs")
app.use(express.static("static"))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Express session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production", 
      // cookie wordt via https gestuurd dus beveiligd
    httpOnly: true,
      // JavaScript kan de cookie in de browser niet lezen beveiligd voor XSS attacks
    maxAge: 60 * 60 * 1000 // 1 uur
  }
}))

// Database connect
async function connectDB() {
  try {
    await client.connect()
    await client.db("admin").command({ ping: 1 })

    await client.db("games").collection("games").createIndex(
      { gameId: 1 },
      { unique: true }
    )

    console.log("✅ Connected to MongoDB")
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err)
  }
}

connectDB()

// minimale eisen wachtwoord functie

function isValidPassword(password) {
  const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/
  return regex.test(password)
}

// moet ingelogd zijn functie
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login")
  }
  next()
}

function normalizeUserGames(user) {
  return Array.isArray(user.games) ? user.games.map(String) : []
}

function calculateMatchScore(currentUser, candidateUser) {
  const currentUserGames = normalizeUserGames(currentUser)
  const candidateGames = normalizeUserGames(candidateUser)
  const sharedGameIds = candidateGames.filter((gameId) => currentUserGames.includes(gameId))
  const gameScore = currentUserGames.length
    ? Math.round((sharedGameIds.length / currentUserGames.length) * 70)
    : 0
  const styleScore =
    currentUser.playStyle && candidateUser.playStyle && currentUser.playStyle === candidateUser.playStyle
      ? 20
      : 0

  const provinceRelevant =
    currentUser.includeProvinceInMatching &&
    currentUser.province &&
    candidateUser.province &&
    currentUser.province === candidateUser.province

  const provinceScore = provinceRelevant ? 10 : 0
  const score = gameScore + styleScore + provinceScore
  const reasons = []

  if (sharedGameIds.length) {
    reasons.push(`${sharedGameIds.length} gedeelde game${sharedGameIds.length > 1 ? "s" : ""}`)
  }

  if (styleScore) {
    reasons.push("dezelfde speelstijl")
  }

  if (provinceScore) {
    reasons.push("zelfde provincie")
  }

  return {
    candidateUser,
    sharedGameIds,
    score,
    reasons,
  }
}

async function getMatchesForCurrentUser(userId) {
  const usersCollection = client.db("accounts").collection("users")
  const gamesCollection = client.db("games").collection("games")
  const currentUser = await usersCollection.findOne({ _id: new ObjectId(userId) })

  if (!currentUser) {
    return { currentUser: null, matches: [] }
  }

  const otherUsers = await usersCollection
    .find({ _id: { $ne: currentUser._id } })
    .toArray()

  const scoredMatches = otherUsers
    .map((candidateUser) => calculateMatchScore(currentUser, candidateUser))
    .filter((match) => match.sharedGameIds.length > 0)
    .sort((a, b) => b.score - a.score)

  const allRelevantGameIds = [
    ...new Set([
      ...normalizeUserGames(currentUser),
      ...scoredMatches.flatMap((match) => match.sharedGameIds),
      ...scoredMatches.flatMap((match) => normalizeUserGames(match.candidateUser)),
    ]),
  ]

  const games = allRelevantGameIds.length
    ? await gamesCollection.find({ gameId: { $in: allRelevantGameIds } }).toArray()
    : []

  const gameMap = new Map(games.map((game) => [String(game.gameId), game]))

  const hydratedCurrentUser = {
    ...currentUser,
    gameDetails: normalizeUserGames(currentUser)
      .map((gameId) => gameMap.get(gameId))
      .filter(Boolean),
  }

  const matches = scoredMatches.map((match) => ({
    ...match.candidateUser,
    score: match.score,
    reasons: match.reasons,
    sharedGames: match.sharedGameIds
      .map((gameId) => gameMap.get(gameId))
      .filter(Boolean),
    gameDetails: normalizeUserGames(match.candidateUser)
      .map((gameId) => gameMap.get(gameId))
      .filter(Boolean),
  }))

  return {
    currentUser: hydratedCurrentUser,
    matches,
  }
}

// Profielfoto opslag
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "static/uploads")
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + path.extname(file.originalname)
    cb(null, uniqueName)
  }
})

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif/
  const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase())
  const mime = allowedTypes.test(file.mimetype)

  if (ext && mime) {
    cb(null, true)
  } else {
    cb("Only images allowed")
  }
}

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
})

// ─── IGDB / Twitch helpers ────────────────────────────────────────────────────

async function getAccessToken() {
  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: "POST" }
  )
  const data = await response.json()
  return data.access_token
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.redirect("/login")
})

app.get("/registreren", (req, res) => {
  res.render("registreren", { error: null, provinces, formData: {} })
})

// Registreren
app.post("/registreren", async (req, res) => {
  const collection = client.db("accounts").collection("users")

  const formData = {
    username: xss(req.body.username),
    email: xss(req.body.email),
    bio: xss(req.body.bio || ""),
    playStyle: xss(req.body.playStyle || ""),
    province: xss(req.body.province || ""),
    includeProvinceInMatching: req.body.includeProvinceInMatching === "on",
  }

  // wachtwoord minimale eisen checken
  if (!isValidPassword(req.body.password)) {
    return res.render("registreren", {
      error: "Wachtwoord moet minimaal 8 tekens bevatten, 1 hoofdletter, 1 cijfer en 1 speciaal teken",
      provinces,
      formData
    })
  }

  const existingUser = await collection.findOne({ email: req.body.email })
  if (existingUser) {
    return res.render("registreren", { error: "Email is al geregistreerd", provinces, formData })
  }

  const existingUsername = await collection.findOne({ username: req.body.username })
  if (existingUsername) {
    return res.render("registreren", { error: "Gebruikersnaam bestaat al", provinces, formData })
  }

  const hashedPassword = await bcrypt.hash(req.body.password, 10)

  await collection.insertOne({
    username: formData.username,
    email: formData.email,
    password: hashedPassword,
    bio: formData.bio,
    profilePicture: "images/defaultAvatar.jpg",
    games: [],
    playStyle: formData.playStyle,
    province: formData.province,
    includeProvinceInMatching: formData.includeProvinceInMatching,
  })

  res.redirect("/login")
})

// Login
app.get("/login", (req, res) => {
  res.render("login")
})

app.post("/login", async (req, res) => {
  const collection = client.db("accounts").collection("users")

  const user = await collection.findOne({ email: req.body.email })
  if (!user) {
    return res.send("User not found")
  }

  const match = await bcrypt.compare(req.body.password, user.password)
  if (!match) {
    return res.send("Wrong password")
  }

  req.session.userId = user._id
  res.redirect("/account")
})

// Account
app.get("/account", requireLogin, async (req, res) => {
  const users = client.db("accounts").collection("users")
  const gamesCol = client.db("games").collection("games")

  const userId = new ObjectId(req.session.userId)

  const user = await users.findOne({ _id: userId })

  const games = await gamesCol.find({
    gameId: { $in: user.games || [] }
  }).toArray()

  res.render("account", { user, games, provinces })
})

// Profiel pagina
app.get("/user/:username", async (req, res) => {
  const collection = client.db("accounts").collection("users")
  const user = await collection.findOne({ username: req.params.username })

  if (!user) {
    return res.status(404).send("User not found")
  }

  res.render("profile", { user })
})

// Profiel updaten
app.post("/update-profile", requireLogin, upload.single("profilePicture"), async (req, res) => {
  const collection = client.db("accounts").collection("users")
  const gamesCol = client.db("games").collection("games")
  const userId = new ObjectId(req.session.userId)

  // huidige user ophalen
  const user = await collection.findOne({ _id: userId })

  const updateData = {}

  if (req.body.bio !== undefined) {
    updateData.bio = xss(req.body.bio)
  }

  if (req.body.username) {
    updateData.username = xss(req.body.username)
  }

  if (req.body.playStyle !== undefined) {
    updateData.playStyle = xss(req.body.playStyle)
  }

  if (req.body.province !== undefined) {
    updateData.province = xss(req.body.province)
  }

  updateData.includeProvinceInMatching = req.body.includeProvinceInMatching === "on"

  // profielfoto upload
  if (req.file) {
    if (user.profilePicture) {
      const oldPath = path.join(__dirname, "static", user.profilePicture)

      if (fs.existsSync(oldPath)) {
        fs.unlink(oldPath, err => {
          if (err) console.error("Error deleting old image:", err)
        })
      }
    }

    updateData.profilePicture = "/uploads/" + req.file.filename
  }

  // wachtwoord check minimale eisen
  if (req.body.newPassword && req.body.newPassword !== "") {

    if (!isValidPassword(req.body.newPassword)) {
      // games opnieuw ophalen zodat pagina correct rendert
      const games = await gamesCol.find({
        gameId: { $in: user.games || [] }
      }).toArray()

      return res.render("account", {
        user,
        games,
        provinces,
        error: "Wachtwoord moet minimaal 8 tekens bevatten, 1 hoofdletter, 1 cijfer en 1 speciaal teken"
      })
    }

    updateData.password = await bcrypt.hash(req.body.newPassword, 10)
  }

  // de update uitvoeren in db
  await collection.updateOne(
    { _id: userId },
    { $set: updateData }
  )

  res.redirect("/account")
})

app.get("/matching", requireLogin, async (req, res) => {
  try {
    const { currentUser, matches } = await getMatchesForCurrentUser(req.session.userId)

    if (!currentUser) {
      return res.redirect("/login")
    }

    res.render("matching", {
      currentUser,
      matches,
    })
  } catch (err) {
    console.error("Error loading matches:", err)
    res.status(500).send("Error loading matches")
  }
})
// ─── IGDB API Routes ──────────────────────────────────────────────────────────

// Twitch token ophalen
app.get("/token", async (req, res) => {
  try {
    const response = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
      { method: "POST" }
    )
    const data = await response.json()
    res.json(data)
  } catch (err) {
    console.error("❌ Token error:", err)
    res.status(500).send("Error getting token")
  }
})

// Mobile games ophalen
app.get("/mobile-games", async (req, res) => {
  try {
    const accessToken = await getAccessToken()

    const igdbResponse = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "text/plain",
      },
      body: `
        fields name,cover.url,first_release_date,platforms.name,rating;
        where platforms = (34, 39);
        sort first_release_date desc;
        limit 20;
      `,
    })

    const games = await igdbResponse.json()
    res.json(games)
  } catch (err) {
    console.error("❌ Error fetching mobile games:", err)
    res.status(500).send("Error fetching mobile games")
  }
})

// Zoekfunctie
app.get("/search", async (req, res) => {
  try {
    const searchTerm = req.query.game

    if (!searchTerm) {
      return res.json([])
    }

    const accessToken = await getAccessToken()

    const igdbResponse = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "text/plain",
      },
      body: `
        search "${searchTerm}";
        fields name,cover.url,first_release_date,rating;
        where platforms = (34, 39);
        limit 10;
      `,
    })

    const games = await igdbResponse.json()
    res.json(games)
  } catch (err) {
    console.error("Search error:", err)
    res.status(500).send("Error searching games")
  }
})

// game toevoegen aan account --------------------------------------
app.post("/add-game", requireLogin, async (req, res) => {
  const gamesCollection = client.db("games").collection("games") 
  const usersCollection = client.db("accounts").collection("users")

  const userId = new ObjectId(req.session.userId)

  const game = {
    gameId: String(req.body.id), 
    name: req.body.name,
    cover: req.body.cover
  }

  try {
    // 👇 Game wordt maar 1x opgeslagen
    await gamesCollection.updateOne(
      { gameId: game.gameId },
      { $setOnInsert: game },
      { upsert: true }
    )

    // 👇 Voeg toe aan user
    await usersCollection.updateOne(
      { _id: userId },
      { $addToSet: { games: game.gameId } }
    )

    res.json({ success: true })

  } catch (err) {
    console.error("❌ Error adding game:", err)
    res.status(500).json({ success: false })
  }
})


// game verwijderen van account
app.post("/remove-game", requireLogin, async (req, res) => {
  const usersCollection = client.db("accounts").collection("users")

  const userId = new ObjectId(req.session.userId)
  const gameId = String(req.body.id)

  try {
    // 👇 Alleen uit user verwijderen (game blijft bestaan in DB)
    await usersCollection.updateOne(
      { _id: userId },
      { $pull: { games: gameId } }
    )

    res.json({ success: true })

  } catch (err) {
    console.error("❌ Error removing game:", err)
    res.status(500).json({ success: false })
  }
})

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login")
  })
})

// 404
app.use((req, res) => {
  res.status(404).send("404 Not Found")
})

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`)
})
