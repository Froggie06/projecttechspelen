document.addEventListener("DOMContentLoaded", () => {
  // behandelt het versturen van een vriendverzoek vanuit een matchkaart
  const buttons = document.querySelectorAll(".connect-btn")

  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.userId

      try {
        // 🔄 loading state
        btn.innerText = "..."
        btn.disabled = true

        const res = await fetch("/friend-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toUserId: userId })
        })

        const data = await res.json()

        if (data.success) {
          btn.innerText = "Verzoek verzonden"
        } else {
          btn.innerText = "Connect"
          btn.disabled = false
          alert(data.message || "Er ging iets mis")
        }

      } catch (err) {
        console.error(err)
        btn.innerText = "Connect"
        btn.disabled = false
        alert("Server error")
      }
    })
  })

  const provinceFilter = document.querySelector("#provinceFilter")
  const styleFilter = document.querySelector("#styleFilter")
  const resetFiltersButton = document.querySelector("#resetFilters")
  const previousButton = document.querySelector("#prevMatch")
  const nextButton = document.querySelector("#nextMatch")
  const statusLabel = document.querySelector("#carouselStatus")
  const noMatchesMessage = document.querySelector("#noMatchesMessage")
  const cards = [...document.querySelectorAll("[data-match-card]")]

  // NOTITIE FILTEREN:
  // Als de matchingpagina geen filters of matchkaarten heeft, stopt dit script hier.
  // Zo geeft JavaScript geen errors op pagina's waar deze elementen niet bestaan.
  if (!provinceFilter || !styleFilter || !previousButton || !nextButton || !statusLabel || cards.length === 0) {
    return
  }

  // filteredCards bevat alleen de kaarten die door de huidige filters heen komen.
  // currentIndex onthoudt welke kaart in de carousel zichtbaar is.
  let filteredCards = [...cards]
  let currentIndex = 0

  // NOTITIE FILTEREN:
  // Normaliseert filterwaarden zodat hoofdletters/spaties geen verschil maken.
  // Bijvoorbeeld " Utrecht " en "utrecht" worden allebei "utrecht".
  function normalizeFilterValue(value) {
    return String(value || "").trim().toLowerCase()
  }

  // NOTITIE FILTEREN/CAROUSEL:
  // Deze functie tekent de carousel opnieuw na filteren, resetten of klikken op vorige/volgende.
  // Eerst worden alle kaarten verborgen, daarna wordt alleen de actieve gefilterde kaart getoond.
  function renderCarousel() {
    cards.forEach((card) => {
      card.hidden = true
      card.classList.remove("is-active")
    })

    if (filteredCards.length === 0) {
      statusLabel.textContent = "Geen matches gevonden"
      if (noMatchesMessage) {
        noMatchesMessage.hidden = false
      }
      previousButton.disabled = true
      nextButton.disabled = true
      return
    }

    // De kaart op currentIndex is de kaart die de gebruiker nu ziet.
    const activeCard = filteredCards[currentIndex]

    if (noMatchesMessage) {
      noMatchesMessage.hidden = true
    }
    activeCard.hidden = false
    activeCard.classList.add("is-active")

    statusLabel.textContent = `Match ${currentIndex + 1} van ${filteredCards.length}`
    previousButton.disabled = filteredCards.length === 1
    nextButton.disabled = filteredCards.length === 1
  }

  // NOTITIE FILTEREN:
  // Deze functie leest de gekozen filters uit de dropdowns.
  // Daarna blijft een kaart alleen over als provincie EN speelstijl overeenkomen.
  // Een lege dropdown betekent "alles toestaan" voor dat filter.
  function applyFilters() {
    const selectedProvince = normalizeFilterValue(provinceFilter.value)
    const selectedStyle = normalizeFilterValue(styleFilter.value)

    filteredCards = cards.filter((card) => {
      // Deze waarden komen uit data-province en data-play-style in views/matching.ejs.
      const cardProvince = normalizeFilterValue(card.dataset.province)
      const cardStyle = normalizeFilterValue(card.dataset.playStyle)

      // Geen geselecteerde waarde betekent dat dit filter niet actief is.
      const matchesProvince = !selectedProvince || cardProvince === selectedProvince
      const matchesStyle = !selectedStyle || cardStyle === selectedStyle

      return matchesProvince && matchesStyle
    })

    // Na filteren beginnen we weer bij de eerste overgebleven match.
    currentIndex = 0
    renderCarousel()
  }

  // NOTITIE FILTEREN OPSLAAN:
  // Deze functie stuurt de huidige dropdownwaarden naar server.js.
  // De server slaat ze op in MongoDB bij de ingelogde gebruiker.
  async function saveFilters() {
    try {
      await fetch("/matching/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          province: provinceFilter.value,
          playStyle: styleFilter.value,
        })
      })
    } catch (err) {
      console.error("Filters opslaan mislukt:", err)
    }
  }

  // NOTITIE FILTEREN:
  // Deze functie voert de filter uit en slaat daarna de gekozen waarden op.
  function applyAndSaveFilters() {
    applyFilters()
    saveFilters()
  }

  // NOTITIE SORTEREN/CAROUSEL:
  // Deze functie verandert niet de sortering zelf; die komt al uit server.js.
  // Hij bladert alleen vooruit of achteruit door filteredCards en gebruikt modulo
  // zodat je na de laatste kaart weer bij de eerste uitkomt.
  function moveCarousel(direction) {
    if (filteredCards.length <= 1) {
      return
    }

    currentIndex = (currentIndex + direction + filteredCards.length) % filteredCards.length
    renderCarousel()
  }

  // NOTITIE FILTEREN:
  // Bij elke wijziging in een dropdown wordt applyFilters() opnieuw uitgevoerd.
  // Daarna bewaart applyAndSaveFilters() de gekozen waarde in MongoDB.
  provinceFilter.addEventListener("change", applyAndSaveFilters)
  styleFilter.addEventListener("change", applyAndSaveFilters)
  provinceFilter.addEventListener("input", applyAndSaveFilters)
  styleFilter.addEventListener("input", applyAndSaveFilters)

  // NOTITIE CAROUSEL:
  // Vorige gebruikt -1, volgende gebruikt +1.
  previousButton.addEventListener("click", () => moveCarousel(-1))
  nextButton.addEventListener("click", () => moveCarousel(1))

  // NOTITIE FILTEREN:
  // Reset maakt beide dropdowns leeg en toont daarna weer alle matchkaarten.
  resetFiltersButton?.addEventListener("click", () => {
    provinceFilter.value = ""
    styleFilter.value = ""
    applyAndSaveFilters()
  })

  // Bij het laden van de pagina staan de opgeslagen waarden al geselecteerd in matching.ejs.
  // Daarom is alleen applyFilters() nodig om direct de juiste kaarten te tonen.
  renderCarousel()
  applyFilters()
})
