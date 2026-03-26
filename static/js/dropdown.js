// dropdown menu zoekfunctie
const input = document.getElementById("searchInput")
const dropdown = document.getElementById("dropdown")

if (input && dropdown) {
  input.addEventListener("input", async () => {
    const query = input.value

    if (query.length < 2) {
      dropdown.innerHTML = ""
      return
    }

    const response = await fetch(`/search?game=${query}`)
    const games = await response.json()

    dropdown.innerHTML = ""

    games.forEach(game => {
      const div = document.createElement("div")
      div.classList.add("result")

      const cover = game.cover
        ? `https:${game.cover.url}`
        : ""

      div.innerHTML = `
        ${cover ? `<img src="${cover}" width="40">` : ""}
        <span>${game.name}</span>
        <button class="add-btn">+</button>
      `

const button = div.querySelector(".add-btn")
let added = false

button.addEventListener("click", async () => {
  if (!added) {
    await fetch("/add-game", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
      id: game.id, 
      name: game.name,
      cover: cover
    })
    })

    button.textContent = "✔"
    added = true
  } else {
    await fetch("/remove-game", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
      id: game.id, 
      name: game.name,
      cover: cover
    })
    })

    button.textContent = "+"
    added = false
  }
})

      dropdown.appendChild(div)
    })
  })
}
