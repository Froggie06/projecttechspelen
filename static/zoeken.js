
// Dropdown zoekfunctie
const input = document.getElementById("searchInput")
const dropdown = document.getElementById("dropdown")

input.addEventListener("input", async () => {

  const query = input.value

  if(query.length < 2){
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
    `

    dropdown.appendChild(div)

  })

})
