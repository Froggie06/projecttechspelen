const fs = require("fs")
const postcss = require("postcss")
const atImport = require("postcss-import")
const css = fs.readFileSync("static/css/input.css", "utf8")

// process css https://github.com/postcss/postcss-import
const atImport = require("postcss-import")

postcss([atImport()])
  .process(css, {
    from: "static/css/input.css"
  })
  .then((result) => {
    fs.writeFileSync("static/style.min.css", result.css)
    console.log("✅ CSS gebundeld")
  })
  .catch((err) => {
    console.error("CSS fout:", err)
  })