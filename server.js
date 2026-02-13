const express = require('express')
const app = express()

app.set("view engine", "ejs")

app.use(express.static('static'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))



app.listen(2000, () => {
  console.log('Server is running on http://localhost:2000')
})