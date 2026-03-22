require("dotenv").config()

const express = require("express")
const { MongoClient, ObjectId } = require("mongodb")

const app = express()
const port = Number(process.env.PORT) || 3000

const uri = process.env.MONGODB_URI
const client = uri ? new MongoClient(uri) : null
let usersCollection = null

const fallbackGames = [
  "Brawl Stars",
  "Call of Duty: Mobile",
  "Clash Royale",
  "EA Sports FC Mobile",
  "Fortnite",
  "Genshin Impact",
  "League of Legends: Wild Rift",
  "Minecraft",
  "Pokemon GO",
  "Roblox",
  "Rocket League Sideswipe",
  "Stumble Guys",
]

let cachedGames = fallbackGames
let cachedGamesFetchedAt = 0

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

async function connectDB() {
  if (!client) {
    console.log("MongoDB URI ontbreekt, de app draait zonder databaseverbinding.")
    return
  }

  try {
    await client.connect()
    await client.db("admin").command({ ping: 1 })
    usersCollection = client.db().collection("users")
    console.log("Connected to MongoDB")
  } catch (err) {
    console.error("MongoDB connection failed:", err)
  }
}

function normalizeSelection(value) {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

async function fetchAvailableGames() {
  const hasApiConfig =
    process.env.TWITCH_CLIENT_ID &&
    process.env.TWITCH_CLIENT_SECRET &&
    process.env.TWITCH_ACCESS_TOKEN

  if (!hasApiConfig) {
    return {
      availableGames: fallbackGames,
      gamesSource: "fallback",
    }
  }

  const cacheIsFresh = Date.now() - cachedGamesFetchedAt < 1000 * 60 * 15

  if (cacheIsFresh && cachedGames.length > 0) {
    return {
      availableGames: cachedGames,
      gamesSource: "api",
    }
  }

  try {
    const igdbResponse = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: "Bearer " + process.env.TWITCH_ACCESS_TOKEN,
        "Content-Type": "text/plain",
      },
      body: `
        fields name;
        where platforms = (6, 34) & category = (0, 8, 9);
        sort total_rating_count desc;
        limit 24;
      `,
    })

    if (!igdbResponse.ok) {
      throw new Error(`IGDB request failed with status ${igdbResponse.status}`)
    }

    const games = await igdbResponse.json()
    const availableGames = games
      .map((game) => game.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "nl"))

    if (availableGames.length === 0) {
      throw new Error("IGDB gaf geen bruikbare games terug.")
    }

    cachedGames = availableGames
    cachedGamesFetchedAt = Date.now()

    return {
      availableGames,
      gamesSource: "api",
    }
  } catch (err) {
    console.error("Fetching available games failed:", err)

    return {
      availableGames: fallbackGames,
      gamesSource: "fallback",
    }
  }
}

function buildUserProfile(body) {
  return {
    name: (body.name || "").trim(),
    age: Number(body.age) || null,
    bio: (body.bio || "").trim(),
    playStyle: body.playStyle || "",
    province: body.province || "",
    includeProvinceInMatching: body.includeProvinceInMatching === "on",
    games: normalizeSelection(body.games),
    createdAt: new Date(),
  }
}

function validateUserProfile(profile) {
  const errors = []

  if (!profile.name) {
    errors.push("Vul een naam in.")
  }

  if (!profile.playStyle) {
    errors.push("Kies een speelstijl.")
  }

  if (profile.games.length === 0) {
    errors.push("Kies minstens een game.")
  }

  if (profile.age !== null && (profile.age < 12 || profile.age > 99)) {
    errors.push("Leeftijd moet tussen de 12 en 99 liggen.")
  }

  return errors
}

function calculateMatchScore(player, currentUser) {
  const sharedGames = player.games.filter((game) => currentUser.games.includes(game))
  const gameScore = currentUser.games.length
    ? Math.round((sharedGames.length / currentUser.games.length) * 70)
    : 0
  const styleScore = player.playStyle === currentUser.playStyle ? 20 : 0

  let provinceScore = 0
  const provinceRelevant =
    currentUser.includeProvinceInMatching &&
    currentUser.province &&
    player.province &&
    currentUser.province === player.province

  if (provinceRelevant) {
    provinceScore = 10
  }

  const score = gameScore + styleScore + provinceScore
  const reasons = []

  if (sharedGames.length) {
    reasons.push(`${sharedGames.length} gedeelde game${sharedGames.length > 1 ? "s" : ""}`)
  }

  if (styleScore) {
    reasons.push("dezelfde speelstijl")
  }

  if (provinceScore) {
    reasons.push("zelfde provincie")
  }

  return {
    ...player,
    score,
    sharedGames,
    reasons,
  }
}

async function getMatchesForUser(userId) {
  if (!usersCollection) {
    throw new Error("Database is niet verbonden.")
  }

  const currentUser = await usersCollection.findOne({ _id: new ObjectId(userId) })

  if (!currentUser) {
    return { currentUser: null, matches: [] }
  }

  const otherUsers = await usersCollection
    .find({ _id: { $ne: currentUser._id } })
    .sort({ createdAt: -1 })
    .toArray()

  const matches = otherUsers
    .map((player) => calculateMatchScore(player, currentUser))
    .filter((player) => player.sharedGames.length > 0)
    .sort((a, b) => b.score - a.score)

  return { currentUser, matches }
}

connectDB()

app.get("/", (req, res) => {
  res.render("intro")
})

app.get("/signup", async (req, res) => {
  const { availableGames, gamesSource } = await fetchAvailableGames()

  res.render("signup", {
    availableGames,
    provinces,
    errors: [],
    formData: null,
    gamesSource,
  })
})

app.post("/signup", async (req, res) => {
  const { availableGames, gamesSource } = await fetchAvailableGames()
  const profile = buildUserProfile(req.body)
  const errors = validateUserProfile(profile)

  if (errors.length > 0) {
    return res.status(400).render("signup", {
      availableGames,
      provinces,
      errors,
      formData: profile,
      gamesSource,
    })
  }

  if (!usersCollection) {
    return res.status(500).render("signup", {
      availableGames,
      provinces,
      errors: ["De databaseverbinding is nog niet beschikbaar."],
      formData: profile,
      gamesSource,
    })
  }

  try {
    const result = await usersCollection.insertOne(profile)
    res.redirect(`/matching/${result.insertedId.toString()}`)
  } catch (err) {
    console.error("User registration failed:", err)
    res.status(500).render("signup", {
      availableGames,
      provinces,
      errors: ["Er ging iets mis bij het opslaan van je profiel."],
      formData: profile,
      gamesSource,
    })
  }
})

app.get("/matching", async (req, res) => {
  if (!usersCollection) {
    return res.render("matching", {
      currentUser: null,
      matches: [],
      totalUsers: 0,
      errorMessage: "De databaseverbinding is nog niet beschikbaar.",
    })
  }

  const totalUsers = await usersCollection.countDocuments()

  res.render("matching", {
    currentUser: null,
    matches: [],
    totalUsers,
    errorMessage: "",
  })
})

app.get("/matching/:userId", async (req, res) => {
  if (!usersCollection) {
    return res.status(500).render("matching", {
      currentUser: null,
      matches: [],
      totalUsers: 0,
      errorMessage: "De databaseverbinding is nog niet beschikbaar.",
    })
  }

  try {
    const { currentUser, matches } = await getMatchesForUser(req.params.userId)
    const totalUsers = await usersCollection.countDocuments()

    if (!currentUser) {
      return res.status(404).render("matching", {
        currentUser: null,
        matches: [],
        totalUsers,
        errorMessage: "Deze gebruiker kon niet worden gevonden.",
      })
    }

    res.render("matching", {
      currentUser,
      matches,
      totalUsers,
      errorMessage: "",
    })
  } catch (err) {
    console.error("Loading matches failed:", err)
    res.status(500).render("matching", {
      currentUser: null,
      matches: [],
      totalUsers: 0,
      errorMessage: "Er ging iets mis bij het laden van de matches.",
    })
  }
})

app.get("/token", async (req, res) => {
  try {
    const response = await fetch(
      "https://id.twitch.tv/oauth2/token?client_id=" +
        process.env.TWITCH_CLIENT_ID +
        "&client_secret=" +
        process.env.TWITCH_CLIENT_SECRET +
        "&grant_type=client_credentials",
      { method: "POST" }
    )

    const data = await response.json()
    res.json(data)
  } catch (err) {
    console.error("Token error:", err)
    res.status(500).send("Error getting token")
  }
})

app.get("/mobile-games", async (req, res) => {
  try {
    const accessToken = process.env.TWITCH_ACCESS_TOKEN

    if (!accessToken || !process.env.TWITCH_CLIENT_ID) {
      return res
        .status(500)
        .json({ error: "TWITCH_ACCESS_TOKEN of TWITCH_CLIENT_ID ontbreekt in .env" })
    }

    const igdbResponse = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "text/plain",
      },
      body: `
        fields name,cover.url,first_release_date,platforms.name,rating;
        where platforms = (6, 34);
        sort first_release_date desc;
        limit 20;
      `,
    })

    const games = await igdbResponse.json()
    res.json(games)
  } catch (err) {
    console.error("Error fetching mobile games:", err)
    res.status(500).send("Error fetching mobile games")
  }
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
