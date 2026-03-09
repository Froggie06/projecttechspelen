require("dotenv").config()

const express = require('express')

const { MongoClient, ServerApiVersion } = require("mongodb")

const app = express()

const uri = process.env.MONGODB_URI

const client = new MongoClient(uri)

app.set("view engine", "ejs")

app.use(express.static('static'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

async function connectDB() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 })
    console.log("✅ Connected to MongoDB")
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err)
  }
}

connectDB()

app.listen(2000, () => {
  console.log('Server is running on http://localhost:2000')
})