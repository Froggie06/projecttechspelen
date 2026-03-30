document.addEventListener("DOMContentLoaded", () => {
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
})