require("dotenv").config()

const express = require("express")
const { MongoClient } = require("mongodb")

const app = express()

const uri = process.env.MONGODB_URI
const client = new MongoClient(uri)

app.set("view engine", "ejs")

app.use(express.static("static"))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// mongodb connect
async function connectDB() {
  try {
    await client.connect()
    await client.db("admin").command({ ping: 1 })
    console.log("✅ Connected to MongoDB")
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err)
  }
}

connectDB()

// API ophalen
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
    console.log(data)

    res.json(data)
  } catch (err) {
    console.error("❌ Token error:", err)
    res.status(500).send("Error getting token")
  }
})

app.get("/mobile-games", async (req, res) => {
  try {
    const accessToken = "ozendqnzyx1790wipqk62xlgeupdyj"

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
    console.error("❌ Error fetching mobile games:", err)
    res.status(500).send("Error fetching mobile games")
  }
})

   // Zoek functie
async function getAccessToken() {
  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: "POST" }
  )
  const data = await response.json()
  return data.access_token
}

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
        where platforms = (6, 34);
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

app.get("/", (req, res) => {
  res.render("zoeken")
})

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000")
})