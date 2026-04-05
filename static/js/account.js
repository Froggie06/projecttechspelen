// Scroll positie herstellen bij terugkomen via de knoppen bij pagination
const savedScroll = sessionStorage.getItem("accountScroll")
if (savedScroll) {
    document.documentElement.style.scrollBehavior = "auto"
    document.scrollingElement.scrollTop = parseInt(savedScroll)
    sessionStorage.removeItem("accountScroll")
}

document.querySelectorAll(".page-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        sessionStorage.setItem("accountScroll", window.scrollY)
        window.location.href = `/account?page=${btn.dataset.page}`
    })
})