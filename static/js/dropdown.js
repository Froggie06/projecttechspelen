const input = document.getElementById("searchInput")
const dropdown = document.getElementById("dropdown")

function getCurrentPage() {
  const page = Number.parseInt(new URLSearchParams(window.location.search).get("page"), 10)
  return Number.isNaN(page) || page < 1 ? 1 : page
}

function goToPage(page) {
  window.location.href = `/account?page=${page}`
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
        body: JSON.stringify({
          id: gameId,
          currentPage: getCurrentPage()
        })
      })

      const data = await res.json()

      if (data.success) {
        goToPage(data.targetPage || getCurrentPage())
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
                goToPage(data.targetPage || getCurrentPage())
              }

            } else {
              // REMOVE GAME
              const res = await fetch("/remove-game", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  id: game.id,
                  currentPage: getCurrentPage()
                })
              })

              const data = await res.json()

              if (data.success) {
                button.textContent = "+"
                added = false
                goToPage(data.targetPage || getCurrentPage())
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
