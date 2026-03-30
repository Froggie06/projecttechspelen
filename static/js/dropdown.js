const input = document.getElementById("searchInput")
const dropdown = document.getElementById("dropdown")

// ==============================
// HELPER FUNCTIES UI
// ==============================

// toevoegen aan UI
function addGameToUI(game, cover) {
  const list = document.getElementById("game-list")
  const noGamesText = document.getElementById("no-games")

  if (!list) return

  // voorkom dubbele games
  if (document.querySelector(`[data-id="${game.id}"]`)) return

  if (noGamesText) noGamesText.remove()

  const newGame = document.createElement("article")
  newGame.classList.add("game-card")
  newGame.dataset.id = game.id

  newGame.innerHTML = `
    ${cover ? `<img src="${cover}" width="60">` : ""}
    <p>${game.name}</p>
    <button class="remove-game-btn" data-id="${game.id}">
      Verwijderen
    </button>
  `

  list.appendChild(newGame)
}

// verwijderen uit UI
function removeGameFromUI(gameId) {
  const card = document.querySelector(`[data-id="${gameId}"]`)
  if (card) card.remove()

  const list = document.getElementById("game-list")

  if (list && list.children.length === 0) {
    list.innerHTML = ""
    list.insertAdjacentHTML(
      "afterend",
      '<p id="no-games">Je hebt nog geen games toegevoegd.</p>'
    )
  }
}

// ==============================
// REMOVE BUTTON
// ==============================
document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("remove-game-btn")) {
    const gameId = e.target.dataset.id

    try {
      const res = await fetch("/remove-game", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: gameId })
      })

      const data = await res.json()

      if (data.success) {
        removeGameFromUI(gameId)
      }
    } catch (err) {
      console.error("Error removing game:", err)
    }
  }
})

// ==============================
// DROPDOWN SEARCH
// ==============================
if (input && dropdown) {
  input.addEventListener("input", async () => {
    const query = input.value

    if (query.length < 2) {
      dropdown.innerHTML = ""
      return
    }

    try {
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

        // check of game al bestaat
        let added = !!document.querySelector(`[data-id="${game.id}"]`)
        button.textContent = added ? "✔" : "+"

        button.addEventListener("click", async () => {
          try {
            if (!added) {
              // ADD GAME
              const res = await fetch("/add-game", {
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

              const data = await res.json()

              if (data.success) {
                button.textContent = "✔"
                added = true

                addGameToUI(game, cover)
              }

            } else {
              // REMOVE GAME
              const res = await fetch("/remove-game", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  id: game.id
                })
              })

              const data = await res.json()

              if (data.success) {
                button.textContent = "+"
                added = false

                removeGameFromUI(game.id)
              }
            }
          } catch (err) {
            console.error("Error:", err)
          }
        })

        dropdown.appendChild(div)
      })

    } catch (err) {
      console.error("Search error:", err)
    }
  })
}