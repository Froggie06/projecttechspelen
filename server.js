// alle imports en benodigde setup voor de server
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

// provincie lijst
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

// middleware
app.set("view engine", "ejs")
app.use(express.static("static"))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// express session
app.use(session({
  secret: process.env.SESSION_SECRET, //geheime key om sessie te beveiligen -> terug te zien in .env
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

// maakt currentUser beschikbaar in alle EJS templates
app.use(async (req, res, next) => {
  if (!req.session.userId) {
    res.locals.currentUser = null
    return next()
  }

  try {
    const users = client.db("accounts").collection("users")
    const user = await users.findOne({ _id: new ObjectId(req.session.userId) })
    res.locals.currentUser = user || null
  } catch (err) {
    console.error(err)
    res.locals.currentUser = null
  }

  next()
})

// middleware om het aantal vriendverzoeken bij te houden, zodat deze getoond worden in de navbar
app.use(async (req, res, next) => {
  if (!req.session.userId) {
    res.locals.requestCount = 0
    return next()
  }

  const users = client.db("accounts").collection("users")

  try {
    const user = await users.findOne({
      _id: new ObjectId(req.session.userId)
    })

    res.locals.requestCount = user?.friendRequests?.length || 0
  } catch (err) {
    console.error(err)
    res.locals.requestCount = 0
  }

  next()
})

// database connect
async function connectDB() {
  try {
    await client.connect()
    await client.db("admin").command({ ping: 1 })

    await client.db("games").collection("games").createIndex(
      { gameId: 1 }, // voorkomt dubbele games in games collectie
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

// moet ingelogd zijn functie -> voorkomt dat niet ingelogde gebruikers bepaalde routes kunnen bezoeken
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login")
  }
  next()
}

// zorgt dat de games altijd in een array van strings staan
function normalizeUserGames(user) {
  return Array.isArray(user.games) ? user.games.map(String) : []
}

// berekening match percentage en matching onderdelen
function calculateMatchScore(currentUser, candidateUser) {
  const currentUserGames = normalizeUserGames(currentUser)
  const candidateGames = normalizeUserGames(candidateUser) // zorgt dat beide gebruikers vergelijkbare data hebben
  const sharedGameIds = candidateGames.filter((gameId) => currentUserGames.includes(gameId)) // loopt door de games heen van beide gebruikers en kijkt of er games zijn die overeen komen
  const gameScore = currentUserGames.length
    ? Math.round((sharedGameIds.length / currentUserGames.length) * 70) // berekent het percentage gedeelde games en weegt dit voor 70% mee in de totale score
    : 0
  const styleScore =
    currentUser.playStyle && candidateUser.playStyle && currentUser.playStyle === candidateUser.playStyle // berekent het percentage gedeelde speelstijl en weegt dit voor 10% mee in de totale score
      ? 20
      : 0

  const provinceRelevant = // provincie relevantie check, alleen als beide gebruikers hebben aangegeven dat ze provincie mee willen laten wegen in de matching en beide gebruikers een provincie hebben ingevuld
    currentUser.includeProvinceInMatching &&
    currentUser.province &&
    candidateUser.province &&
    currentUser.province === candidateUser.province

  const provinceScore = provinceRelevant ? 10 : 0 // berekent het percentage gedeelde provincie en weegt dit voor 10% mee in de totale score, alleen als beide gebruikers hebben aangegeven dat ze provincie mee willen laten wegen in de matching
  const score = gameScore + styleScore + provinceScore // totale score van de 3 onderdelen samen, max 100%
  const reasons = [] // lijst waarom gebruikers gematched zijn

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

// maakt filteropties aan op basis van de matches die echt gevonden zijn
function buildMatchFilters(matches) {
  const availableGames = new Map()
  const availableProvinces = new Set()
  const availablePlayStyles = new Set()

  matches.forEach((match) => {
    match.gameDetails.forEach((game) => {
      if (game?.gameId && game?.name) {
        availableGames.set(String(game.gameId), game.name)
      }
    })

    if (match?.province) {
      availableProvinces.add(match.province)
    }

    if (match?.playStyle) {
      availablePlayStyles.add(match.playStyle)
    }
  })

  return {
    games: [...availableGames.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "nl")),
    provinces: [...availableProvinces].sort((a, b) => a.localeCompare(b, "nl")),
    playStyles: [...availablePlayStyles]
      .map((playStyle) => ({
        value: playStyle,
        label: playStyle === "competitive" ? "Competitief" : playStyle === "casual" ? "Casual" : playStyle,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "nl")),
  }
}

// haalt de matches op voor de huidige gebruiker
async function getMatchesForCurrentUser(userId) {
  const usersCollection = client.db("accounts").collection("users") // ophalen uit database
  const gamesCollection = client.db("games").collection("games") // ophalen uit database
  const currentUser = await usersCollection.findOne({ _id: new ObjectId(userId) }) // huidige gebruiker ophalen

  if (!currentUser) {
    return {
      currentUser: null,
      matches: [],
      filters: buildMatchFilters([]),
    }
  } // voorkomt dat huidige gebruiker wordt meegenomen in de matches, zoekt alleen naar andere gebruikers in de database die niet dezelfde _id hebben als de huidige gebruiker

  const otherUsers = await usersCollection 
    .find({ _id: { $ne: currentUser._id } })
    .toArray()

  const scoredMatches = otherUsers // voor elke gebruiker een score berekenen
    .map((candidateUser) => calculateMatchScore(currentUser, candidateUser))
    .filter((match) => match.sharedGameIds.length > 0) // voorkomt het tonen van 0% matches
    .sort((a, b) => b.score - a.score) // sorteert de matches op score van hoog naar laag

  const allRelevantGameIds = [ // lijst van games die relevant zijn voor de match
    ...new Set([
      ...normalizeUserGames(currentUser),
      ...scoredMatches.flatMap((match) => match.sharedGameIds),
      ...scoredMatches.flatMap((match) => normalizeUserGames(match.candidateUser)),
    ]),
  ]

  const games = allRelevantGameIds.length 
    ? await gamesCollection.find({ gameId: { $in: allRelevantGameIds } }).toArray() // haalt de games op uit de lijst van games die relevant zijn voor de match
    : []

  const gameMap = new Map(games.map((game) => [String(game.gameId), game])) // maakt een map van gameId naar game object voor snelle lookup, zorgt dat we de details van de games kunnen tonen in de matches zonder dat we meerdere database calls hoeven te doen

  const hydratedCurrentUser = { // voegt de game details toe zodat deze ook in de view komen te staan
    ...currentUser,
    gameDetails: normalizeUserGames(currentUser)
      .map((gameId) => gameMap.get(gameId))
      .filter(Boolean),
  }

  const matches = scoredMatches.map((match) => {
    const candidate = match.candidateUser

    const isFriend = currentUser.friends?.some(
      id => id.toString() === candidate._id.toString()
    )

    const requestSent = candidate.friendRequests?.some(
      req => req.from.toString() === currentUser._id.toString()
    )

    return {
      ...candidate,
      score: match.score,
      reasons: match.reasons,
      isFriend,
      requestSent,
      sharedGames: match.sharedGameIds
        .map((gameId) => gameMap.get(gameId))
        .filter(Boolean),
      gameDetails: normalizeUserGames(candidate)
        .map((gameId) => gameMap.get(gameId))
        .filter(Boolean),
    }
  })

  const filters = buildMatchFilters(matches)

  return {
    currentUser: hydratedCurrentUser,
    matches,
    filters,
  }
}

// profielfoto opslag met multer in uploads map
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "static/uploads")
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + path.extname(file.originalname)
    cb(null, uniqueName)
  }
})

// file filter om alleen afbeeldingen toe te staan en max grootte 5mb
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif/
  const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase()) 
  const mime = allowedTypes.test(file.mimetype) // controleren of het bestand een afbeelding is

  if (ext && mime) {
    cb(null, true)
  } else {
    cb("Only images allowed") // error teruggeven als het geen afbeelding is
  }
}

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // max 5mb
})

// IGDB / Twitch helpers https://api-docs.igdb.com/#getting-started
// haalt token op van Twitch API, nodig voor IGDB API calls
async function getAccessToken() {
  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: "POST" }
  )
  const data = await response.json()
  return data.access_token
}

// routes
app.get("/", (req, res) => {
  res.render("home")
})

app.get("/home", (req, res) => {
  res.render("home")
})

app.get("/registreren", (req, res) => {
  res.render("registreren", { error: null, provinces, formData: {} })
})

// registreren
app.post("/registreren", async (req, res) => {
  const collection = client.db("accounts").collection("users")

  const formData = {
    username: xss(req.body.username),
    email: xss(req.body.email),
    bio: xss(req.body.bio || ""),
    playStyle: xss(req.body.playStyle || ""),
    province: xss(req.body.province || ""),
    includeProvinceInMatching: req.body.includeProvinceInMatching === "on", // checkt of checkbox is aangevinkt
  }

  // wachtwoord minimale eisen checken
  if (!isValidPassword(req.body.password)) {
    return res.render("registreren", {
      error: "Wachtwoord moet minimaal 8 tekens bevatten, 1 hoofdletter, 1 cijfer en 1 speciaal teken",
      provinces,
      formData
    })
  }

  const existingUser = await collection.findOne({ email: req.body.email }) // checkt of email al in gebruik is in database
  if (existingUser) {
    return res.render("registreren", { error: "Email is al geregistreerd", provinces, formData })
  }

  const existingUsername = await collection.findOne({ username: req.body.username }) // checkt of gebruikersnaam al in gebruik is in database
  if (existingUsername) {
    return res.render("registreren", { error: "Gebruikersnaam bestaat al", provinces, formData })
  }

  const hashedPassword = await bcrypt.hash(req.body.password, 10) // wachtwoord hashen met bcrypt voor veiligheid voordat het in database wordt opgeslagen

  // nieuwe user aanmaken in database
await collection.insertOne({
  username: formData.username,
  email: formData.email,
  password: hashedPassword,
  bio: formData.bio,
  profilePicture: "/images/defaultAvatar.jpg",
  games: [],
  playStyle: formData.playStyle,
  province: formData.province,
  includeProvinceInMatching: formData.includeProvinceInMatching,
  friends: [],
  friendRequests: []
})

  res.redirect("/login")
})

// login
app.get("/login", (req, res) => {
  res.render("login")
})

// gebruiker inlog checken en sessie starten
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

// account
app.get("/account", requireLogin, async (req, res) => { // moet ingelogd zijn om account pagina te kunnen bezoeken, anders redirect naar login pagina
  const users = client.db("accounts").collection("users") // haalt gegevens van user op uit database om te kunnen tonen op account pagina
  const gamesCol = client.db("games").collection("games")

  const userId = new ObjectId(req.session.userId) // haalt de userId op uit de sessie, deze is opgeslagen bij het inloggen en wordt gebruikt om de juiste gegevens van de gebruiker op te halen uit de database

  const user = await users.findOne({ _id: userId })

  const games = await gamesCol.find({ // haalt de games op die in de database die zijn opgeslagen door deze gebruiker
    gameId: { $in: user.games || [] }
  }).toArray()

  res.render("account", { user, games, provinces })
})

// publieke profiel pagina
app.get("/user/:username", async (req, res) => {
  const collection = client.db("accounts").collection("users")
  const user = await collection.findOne({ username: req.params.username })

  if (!user) {
    return res.status(404).send("User not found") // error als gebruiker niet bestaat
  }

  res.render("profile", { user })
})

// profiel updaten
app.post("/update-profile", requireLogin, upload.single("profilePicture"), async (req, res) => { // moet ingelogd zijn om profiel te kunnen updaten, anders redirect naar login pagina
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
        fs.unlink(oldPath, err => { // oude afbeelding verwijderen
          if (err) console.error("Error deleting old image:", err) // error in console als er iets misgaat bij het verwijderen van de oude profielfoto
        })
      }
    }

    updateData.profilePicture = "/uploads/" + req.file.filename
  }

  // wachtwoord check minimale eisen bij updaten
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

    updateData.password = await bcrypt.hash(req.body.newPassword, 10) // nieuw wachtwoord hashen met bcrypt voor veiligheid voordat het in database wordt opgeslagen
  }

  // de update uitvoeren in database
  await collection.updateOne(
    { _id: userId },
    { $set: updateData }
  )

  res.redirect("/account")
})

// haalt de matches van de gebruiker op en laat deze zien op de ejs matching pagina, moet ingelogd zijn om deze pagina te kunnen bezoeken anders redirect naar login pagina
app.get("/matching", requireLogin, async (req, res) => {
  try {
    const { currentUser, matches, filters } = await getMatchesForCurrentUser(req.session.userId)

    if (!currentUser) {
      return res.redirect("/login")
    }

    res.render("matching", {
      currentUser,
      matches,
      filters,
    })
  } catch (err) {
    console.error("Error loading matches:", err)
    res.status(500).send("Error loading matches")
  }
})

// vriendverzoek route, moet ingelogd zijn om een vriendverzoek te kunnen sturen, anders redirect naar login pagina
app.post("/friend-request", requireLogin, async (req, res) => {
  const users = client.db("accounts").collection("users")

  const fromUserId = new ObjectId(req.session.userId)
  const toUserId = new ObjectId(req.body.toUserId)

  try {
    const targetUser = await users.findOne({ _id: toUserId })

    // zorgt dat je geen vriendverzoek naar jezelf kunt sturen
    if (fromUserId.equals(toUserId)) {
      return res.json({ success: false, message: "Kan jezelf niet toevoegen" })
    }

    // checkt of de gebruiker al vrienden is, voorkomt dat er meerdere verzoeken worden gestuurd naar dezelfde gebruiker
    if (targetUser.friends?.some(id => id.toString() === fromUserId.toString())) {
      return res.json({ success: false, message: "Al vrienden" })
    }

    // checkt of er al een request is gestuurd naar een andere gebruiker, voorkomt dat er meerdere verzoeken worden gestuurd naar dezelfde gebruiker
    const alreadyRequested = targetUser.friendRequests?.some(
      req => req.from.toString() === fromUserId.toString()
    )

    if (alreadyRequested) {
      return res.json({ success: false, message: "Al verzonden" })
    }

    // request toevoegen
    await users.updateOne(
      { _id: toUserId },
      {
        $push: {
          friendRequests: {
            from: fromUserId,
            status: "pending"
          }
        }
      }
    )

    res.json({ success: true })

  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false })
  }
})

// vriendenlijst en binnenkomende vriendverzoeken tonen, moet ingelogd zijn om deze pagina te kunnen bezoeken, anders redirect naar login pagina
app.get("/friends", requireLogin, async (req, res) => {
  const users = client.db("accounts").collection("users")

  const user = await users.findOne({
    _id: new ObjectId(req.session.userId)
  })

  // haal info van request users
  const requestIds = user.friendRequests?.map(r => r.from) || []

  const requestUsers = await users.find({
    _id: { $in: requestIds }
  }).toArray()

  const friends = await users.find({
    _id: { $in: user.friends || [] }
  }).toArray()

  res.render("friends", {
    requests: requestUsers,
    friends
  })
})

// vriendverzoek accepteren, moet ingelogd zijn om een vriendverzoek te kunnen accepteren, anders redirect naar login pagina
app.post("/friend-request/accept", requireLogin, async (req, res) => {
  const users = client.db("accounts").collection("users")

  const currentUserId = new ObjectId(req.session.userId)
  const fromUserId = new ObjectId(req.body.fromUserId)

  try {
    // voeg elkaar toe als vrienden
    await users.updateOne(
      { _id: currentUserId },
      {
        $pull: { friendRequests: { from: fromUserId } },
        $addToSet: { friends: fromUserId }
      }
    )

    await users.updateOne(
      { _id: fromUserId },
      {
        $addToSet: { friends: currentUserId }
      }
    )

    res.redirect("/friends")

  } catch (err) {
    console.error(err)
    res.status(500).send("Error")
  }
})

// vriendverzoek afwijzen, moet ingelogd zijn om een vriendverzoek te kunnen afwijzen, anders redirect naar login pagina
app.post("/friend-request/reject", requireLogin, async (req, res) => {
  const users = client.db("accounts").collection("users")

  const currentUserId = new ObjectId(req.session.userId)
  const fromUserId = new ObjectId(req.body.fromUserId)

  try {
    await users.updateOne(
      { _id: currentUserId },
      {
        $pull: { friendRequests: { from: fromUserId } }
      }
    )

    res.redirect("/friends")

  } catch (err) {
    console.error(err)
    res.status(500).send("Error")
  }
})

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

// zoekfunctie dropdown voor games toevoegen
app.get("/search", async (req, res) => {
  try {
    const searchTerm = req.query.game

    if (!searchTerm) {
      return res.json([])
    }

    const accessToken = await getAccessToken()
    // IGDB API call om games te zoeken op basis van de ingevoerde zoekterm, filtert op android en ios games
    const igdbResponse = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "text/plain",
      },
      // filtert hier op android en ios games
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
    res.status(500).send("Error searching games") // error teruggeven als er iets misgaat bij het zoeken van games, zodat de view hierop reageert en de dropdown leegmaakt
  }
})

// game toevoegen aan account
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
    // game wordt maar 1x opgeslagen
    await gamesCollection.updateOne(
      { gameId: game.gameId },
      { $setOnInsert: game },
      { upsert: true }
    )

    // game toevoegen aan user
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


// game verwijderen van user account, game blijft wel bestaan in games collectie zodat deze nog steeds zichtbaar is in matches van andere gebruikers die deze game ook hebben toegevoegd
app.post("/remove-game", requireLogin, async (req, res) => {
  const usersCollection = client.db("accounts").collection("users")

  const userId = new ObjectId(req.session.userId)
  const gameId = String(req.body.id)

  try {
    // alleen uit user verwijderen (game blijft bestaan in database)
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

// uitloggen, sessie vernietigen en redirect naar login pagina
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
