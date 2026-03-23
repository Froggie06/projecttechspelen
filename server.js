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

const uri = process.env.MONGODB_URI
const client = new MongoClient(uri)

app.set("view engine", "ejs")
app.use(express.static("static"))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Express session
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}))

// Database connect
async function connectDB() {
  try {
    await client.connect()
    await client.db("admin").command({ ping: 1 })

    // 👇 HIER je index maken
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


// Require login functie
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login")
  }
  next()
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
  res.render("account")
})

// Registreren
app.get("/registreren", (req, res) => {
  res.render("registreren", { error: null })
})

app.post("/registreren", async (req, res) => {
  const collection = client.db("accounts").collection("users")

  const existingUser = await collection.findOne({ email: req.body.email })
  if (existingUser) {
    return res.render("registreren", { error: "Email is al geregistreerd" })
  }

  const existingUsername = await collection.findOne({ username: req.body.username })
  if (existingUsername) {
    return res.render("registreren", { error: "Gebruikersnaam bestaat al" })
  }

  const hashedPassword = await bcrypt.hash(req.body.password, 10)

  await collection.insertOne({
    username: xss(req.body.username),
    email: xss(req.body.email),
    password: hashedPassword,
    bio: "",
    profilePicture: "images/defaultAvatar.jpg",
    games: []
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

  res.render("account", { user, games })
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
  const userId = new ObjectId(req.session.userId)

  // Haal huidige user op
  const user = await collection.findOne({ _id: userId })

  const updateData = {}

  if (req.body.bio !== undefined) {
    updateData.bio = xss(req.body.bio)
  }

  if (req.body.username) {
    updateData.username = xss(req.body.username)
  }

  // Alleen als er een nieuwe foto is
  if (req.file) {

    // Verwijder oude foto
    if (user.profilePicture) {
      const oldPath = path.join(__dirname, "static", user.profilePicture)

      if (fs.existsSync(oldPath)) {
        fs.unlink(oldPath, err => {
          if (err) console.error("Error deleting old image:", err)
        })
      }
    }

    // Nieuwe foto opslaan
    updateData.profilePicture = "/uploads/" + req.file.filename
  }

  if (req.body.newPassword && req.body.newPassword !== "") {
    updateData.password = await bcrypt.hash(req.body.newPassword, 10)
  }

  // Update database
  await collection.updateOne(
    { _id: userId },
    { $set: updateData }
  )

  res.redirect("/account")
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
    //  Game wordt maar 1x opgeslagen
    await gamesCollection.updateOne(
      { gameId: game.gameId },
      { $setOnInsert: game },
      { upsert: true }
    )

    //  Voeg toe aan user
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


// Game verwijderen account ----------------------------------------------
app.post("/remove-game", requireLogin, async (req, res) => {
  const usersCollection = client.db("accounts").collection("users")

  const userId = new ObjectId(req.session.userId)
  const gameId = String(req.body.id)

  try {
    // Alleen uit user verwijderen (game blijft bestaan in DB)
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

// 404
app.use((req, res) => {
  res.status(404).send("404 Not Found")
})

app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000")
})