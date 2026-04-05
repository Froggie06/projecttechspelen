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

  if (!provinceFilter || !styleFilter || !previousButton || !nextButton || !statusLabel || cards.length === 0) {
    return
  }

  let filteredCards = [...cards]
  let currentIndex = 0

  function normalizeFilterValue(value) {
    return String(value || "").trim().toLowerCase()
  }

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

  function applyFilters() {
    const selectedProvince = normalizeFilterValue(provinceFilter.value)
    const selectedStyle = normalizeFilterValue(styleFilter.value)

    filteredCards = cards.filter((card) => {
      const cardProvince = normalizeFilterValue(card.dataset.province)
      const cardStyle = normalizeFilterValue(card.dataset.playStyle)
      const matchesProvince = !selectedProvince || cardProvince === selectedProvince
      const matchesStyle = !selectedStyle || cardStyle === selectedStyle

      return matchesProvince && matchesStyle
    })

    currentIndex = 0
    renderCarousel()
  }

  function moveCarousel(direction) {
    if (filteredCards.length <= 1) {
      return
    }

    currentIndex = (currentIndex + direction + filteredCards.length) % filteredCards.length
    renderCarousel()
  }

  provinceFilter.addEventListener("change", applyFilters)
  styleFilter.addEventListener("change", applyFilters)
  provinceFilter.addEventListener("input", applyFilters)
  styleFilter.addEventListener("input", applyFilters)

  previousButton.addEventListener("click", () => moveCarousel(-1))
  nextButton.addEventListener("click", () => moveCarousel(1))

  resetFiltersButton?.addEventListener("click", () => {
    provinceFilter.value = ""
    styleFilter.value = ""
    applyFilters()
  })

  renderCarousel()
})
