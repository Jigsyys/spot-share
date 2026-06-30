const header = document.querySelector("[data-header]");
const toggle = document.querySelector("[data-menu-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");
const revealItems = document.querySelectorAll(".reveal");

const drawer = document.getElementById("booking-drawer");
const overlay = document.getElementById("booking-overlay");
const closeButton = document.getElementById("booking-close");
const calendarEl = document.getElementById("booking-calendar");
const calendarTitle = document.getElementById("calendar-title");
const prevButton = document.getElementById("calendar-prev");
const nextButton = document.getElementById("calendar-next");
const reservationForm = document.getElementById("reservation-form");
const guestsInput = document.getElementById("guests");
const cleaningInput = document.getElementById("option-cleaning");
const petsInput = document.getElementById("option-pets");
const statusBox = document.getElementById("availability-status");
const priceEstimate = document.getElementById("price-estimate");
const reservationMessage = document.getElementById("reservation-message");
const seasonNotes = document.querySelectorAll("[data-season-note]");
const seasonPrices = document.querySelectorAll("[data-season-price]");
const googleReviewsList = document.getElementById("google-reviews-list");
const googleRating = document.getElementById("google-rating");
const googleReviewCount = document.getElementById("google-review-count");
const googleReviewsSummary = document.getElementById("google-reviews-summary");

let airbnbReservations = [];
let calendarLoaded = false;
let visibleMonth = new Date();
let selectedStart = null;
let selectedEnd = null;

function updateHeader() {
  header?.classList.toggle("is-scrolled", window.scrollY > 24);
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

toggle?.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("menu-open");
  mobileNav?.classList.toggle("is-open", isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
});

mobileNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    document.body.classList.remove("menu-open");
    mobileNav.classList.remove("is-open");
  });
});

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");
const lightboxTriggers = Array.from(document.querySelectorAll(".lightbox-trigger"));
let lightboxIndex = 0;

function openLightbox(index) {
  if (!lightbox || !lightboxTriggers.length) return;
  lightboxIndex = (index + lightboxTriggers.length) % lightboxTriggers.length;
  const img = lightboxTriggers[lightboxIndex].querySelector("img");
  if (!img) return;
  lightboxImage.src = img.src;
  lightboxImage.alt = img.alt;
  lightbox.hidden = false;
}

function closeLightbox() {
  if (!lightbox) return;
  lightbox.hidden = true;
  lightboxImage.src = "";
}

lightboxTriggers.forEach((trigger, index) => {
  trigger.addEventListener("click", () => openLightbox(index));
});

lightboxClose?.addEventListener("click", closeLightbox);
lightboxPrev?.addEventListener("click", () => openLightbox(lightboxIndex - 1));
lightboxNext?.addEventListener("click", () => openLightbox(lightboxIndex + 1));
lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (event) => {
  if (!lightbox || lightbox.hidden) return;
  if (event.key === "Escape") closeLightbox();
  if (event.key === "ArrowRight") openLightbox(lightboxIndex + 1);
  if (event.key === "ArrowLeft") openLightbox(lightboxIndex - 1);
});

let lastFocusedElement = null;

function getFocusableDrawerElements() {
  return Array.from(drawer.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])'));
}

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const focusable = getFocusableDrawerElements();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openBooking(event) {
  event?.preventDefault();
  lastFocusedElement = document.activeElement;
  overlay.hidden = false;
  requestAnimationFrame(() => {
    overlay.classList.add("is-open");
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    closeButton?.focus();
  });
  drawer.addEventListener("keydown", trapFocus);
  renderCalendar();
}

function closeBooking() {
  overlay.classList.remove("is-open");
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  drawer.removeEventListener("keydown", trapFocus);
  setTimeout(() => {
    overlay.hidden = true;
  }, 220);
  lastFocusedElement?.focus();
}

document.querySelectorAll("[data-open-booking]").forEach((link) => {
  link.addEventListener("click", openBooking);
});
closeButton?.addEventListener("click", closeBooking);
overlay?.addEventListener("click", closeBooking);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeBooking();
});

function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatFrenchDate(value) {
  const date = typeof value === "string" ? parseLocalDate(value) : value;
  if (!date) return "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function nightsBetween(startValue, endValue) {
  const start = parseLocalDate(startValue);
  const end = parseLocalDate(endValue);
  if (!start || !end) return 0;
  return Math.round((end - start) / 86400000);
}

function isHighSeason(startValue) {
  const start = parseLocalDate(startValue);
  if (!start) return false;
  const month = start.getMonth() + 1;
  return month >= 5 && month <= 8;
}

function updateSeasonNotes() {
  const highSeason = isHighSeason(toISO(new Date()));
  const price = highSeason ? "85 €" : "75 €";
  const text = "Prix dès 3 nuits.";
  seasonPrices.forEach((priceEl) => {
    priceEl.textContent = price;
  });
  seasonNotes.forEach((note) => {
    note.textContent = text;
  });
}

updateSeasonNotes();

function basePrice(nights, highSeason) {
  if (nights <= 0) return 0;
  if (highSeason) {
    if (nights === 1) return 95;
    if (nights === 2) return 180;
    return nights * 85;
  }
  if (nights === 1) return 85;
  if (nights === 2) return 160;
  return nights * 75;
}

function setStatus(type, text) {
  statusBox.className = `availability-status status-${type}`;
  statusBox.textContent = text;
}

function rangesOverlap(startValue, endValue, reservation) {
  const requestedStart = parseLocalDate(startValue);
  const requestedEnd = parseLocalDate(endValue);
  const bookedStart = parseLocalDate(reservation.start);
  const bookedEnd = parseLocalDate(reservation.end);
  return requestedStart < bookedEnd && requestedEnd > bookedStart;
}

function isBooked(dateValue) {
  const date = parseLocalDate(dateValue);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  return airbnbReservations.some((reservation) => rangesOverlap(dateValue, toISO(nextDay), reservation));
}

function hasAirbnbConflict(startValue, endValue) {
  return airbnbReservations.some((reservation) => rangesOverlap(startValue, endValue, reservation));
}

function updateReservationSummary() {
  if (!selectedStart || !selectedEnd) {
    priceEstimate.textContent = "0 €";
    reservationMessage.textContent = selectedStart
      ? "Choisissez maintenant la date de départ."
      : "Sélectionnez vos dates pour calculer le prix.";
    setStatus(calendarLoaded ? "neutral" : "warning", calendarLoaded
      ? "Sélectionnez une date d'arrivée puis une date de départ."
      : "Calendrier Airbnb non chargé : les hôtes confirmeront la disponibilité.");
    return;
  }

  const nights = nightsBetween(selectedStart, selectedEnd);
  if (nights <= 0) {
    priceEstimate.textContent = "0 €";
    setStatus("warning", "La date de départ doit être après la date d'arrivée.");
    return;
  }

  let total = basePrice(nights, isHighSeason(selectedStart));
  if (cleaningInput.checked) total += 30;
  if (petsInput.checked) total += 10;
  priceEstimate.textContent = `${total.toLocaleString("fr-FR")} €`;

  if (calendarLoaded && hasAirbnbConflict(selectedStart, selectedEnd)) {
    setStatus("booked", "Déjà réservé sur Airbnb pour tout ou partie de ces dates. Essayez une autre période.");
    reservationMessage.textContent = "La demande est bloquée tant que la période chevauche une réservation Airbnb.";
    return;
  }

  setStatus("available", `Aucune réservation Airbnb détectée du ${formatFrenchDate(selectedStart)} au ${formatFrenchDate(selectedEnd)}.`);
  reservationMessage.textContent = `${nights} nuit(s), tarif estimé selon la saison et les options.`;
}

function renderCalendar() {
  if (!calendarEl) return;

  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const monthEnd = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  calendarTitle.textContent = monthStart.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  calendarEl.innerHTML = "";

  ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].forEach((day) => {
    const label = document.createElement("div");
    label.className = "calendar-weekday";
    label.textContent = day;
    calendarEl.appendChild(label);
  });

  const firstDayIndex = (monthStart.getDay() + 6) % 7;
  for (let i = 0; i < firstDayIndex; i += 1) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "calendar-day is-empty";
    empty.tabIndex = -1;
    calendarEl.appendChild(empty);
  }

  for (let day = 1; day <= monthEnd.getDate(); day += 1) {
    const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
    const dateValue = toISO(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.textContent = String(day);
    button.dataset.date = dateValue;

    const booked = calendarLoaded && isBooked(dateValue);
    const past = date < today;
    const isToday = date.getTime() === today.getTime();
    const inRange = selectedStart && selectedEnd && date >= parseLocalDate(selectedStart) && date <= parseLocalDate(selectedEnd);

    if (past) button.classList.add("is-past");
    if (isToday) button.classList.add("is-today");
    if (booked) button.classList.add("is-booked");
    if (dateValue === selectedStart || dateValue === selectedEnd) button.classList.add("is-selected");
    else if (inRange) button.classList.add("is-range");

    button.disabled = past;
    button.addEventListener("click", () => selectDate(dateValue));
    calendarEl.appendChild(button);
  }
}

function selectDate(dateValue) {
  if (!selectedStart || selectedEnd || dateValue < selectedStart) {
    selectedStart = dateValue;
    selectedEnd = null;
  } else {
    selectedEnd = dateValue;
  }
  renderCalendar();
  updateReservationSummary();
}

prevButton?.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});

nextButton?.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});

async function loadAirbnbCalendar() {
  try {
    const response = await fetch("ical-proxy.php", { cache: "no-store" });
    if (!response.ok) throw new Error("Proxy indisponible");
    airbnbReservations = await response.json();
    calendarLoaded = true;
  } catch (proxyError) {
    try {
      const response = await fetch("airbnb_cache.ics", { cache: "no-store" });
      if (!response.ok) throw new Error("Cache indisponible");
      const ics = await response.text();
      airbnbReservations = parseIcsReservations(ics);
      calendarLoaded = true;
    } catch (cacheError) {
      calendarLoaded = false;
      setStatus("warning", "Impossible de charger le calendrier Airbnb. Les hôtes confirmeront la disponibilité.");
    }
  }
  renderCalendar();
  updateReservationSummary();
}

function renderGoogleReviewsFallback(message = "Les avis Google seront affichés ici dès que la fiche sera connectée.") {
  if (googleReviewsList) {
    googleReviewsList.innerHTML = `
      <article class="google-review-card review-empty">
        <span>Google</span>
        <p>${escapeHtml(message)}</p>
      </article>
    `;
  }
  if (googleRating) googleRating.textContent = "Avis Google vérifiés";
  if (googleReviewCount) googleReviewCount.textContent = "Lien officiel disponible.";
}

async function loadGoogleReviews() {
  if (!googleReviewsList) return;

  try {
    const response = await fetch("google-reviews.php", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.configured || !Array.isArray(data.reviews) || data.reviews.length === 0) {
      renderGoogleReviewsFallback(data.error);
      return;
    }

    if (googleRating) {
      googleRating.textContent = data.rating ? `${Number(data.rating).toFixed(1).replace(".", ",")} / 5 sur Google` : "Avis Google vérifiés";
    }
    if (googleReviewCount) {
      googleReviewCount.textContent = data.userRatingsTotal ? `${data.userRatingsTotal} avis Google` : "Avis Google";
    }
    if (googleReviewsSummary && data.url) {
      const link = googleReviewsSummary.querySelector("a");
      if (link) link.href = data.url;
    }

    googleReviewsList.innerHTML = data.reviews.map((review) => `
      <article class="google-review-card reveal is-visible">
        <div class="review-card-top">
          <span>${"★".repeat(Math.round(Number(review.rating) || 0))}</span>
          <small>${escapeHtml(review.time || "Avis Google")}</small>
        </div>
        <p>${escapeHtml(review.text || "Avis vérifié sur Google.")}</p>
        <cite>${escapeHtml(review.author || "Voyageur Google")}</cite>
      </article>
    `).join("");
  } catch (error) {
    renderGoogleReviewsFallback("Les avis Google sont momentanément indisponibles.");
  }
}

function parseIcsReservations(icsText) {
  const matches = [...icsText.matchAll(/DTSTART(?:;VALUE=DATE)?:(\d{8})[\s\S]*?DTEND(?:;VALUE=DATE)?:(\d{8})/g)];
  return matches.map((match) => ({
    start: `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`,
    end: `${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6, 8)}`
  }));
}

function buildReservationPayload() {
  const options = [];
  if (cleaningInput.checked) options.push("Ménage (+30 €)");
  if (petsInput.checked) options.push("Animaux (+10 €)");
  const nights = nightsBetween(selectedStart, selectedEnd);
  const highSeason = isHighSeason(selectedStart);

  return {
    nom: document.getElementById("guest-name").value.trim(),
    email: document.getElementById("guest-email").value.trim(),
    telephone: document.getElementById("guest-phone").value.trim(),
    arrivee: selectedStart,
    depart: selectedEnd,
    dates: `${formatFrenchDate(selectedStart)} au ${formatFrenchDate(selectedEnd)}`,
    nuits: nights,
    saison: highSeason ? "Haute saison" : "Basse saison",
    voyageurs: guestsInput.value,
    menage: cleaningInput.checked,
    animaux: petsInput.checked,
    options: options.length ? options.join(", ") : "Aucune option",
    total: priceEstimate.textContent,
    statut: statusBox.textContent
  };
}

async function createStripeCheckout(payload) {
  const response = await fetch("stripe-checkout.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) {
    throw new Error(data.error || "Réservation en ligne indisponible pour le moment.");
  }
  return data.url;
}

async function submitReservation(event) {
  event.preventDefault();
  updateReservationSummary();

  if (!selectedStart || !selectedEnd) {
    setStatus("warning", "Merci de sélectionner une date d'arrivée et une date de départ.");
    return;
  }

  if (calendarLoaded && hasAirbnbConflict(selectedStart, selectedEnd)) {
    setStatus("booked", "Ces dates semblent déjà réservées sur Airbnb. Merci de choisir une autre période.");
    return;
  }

  if (!reservationForm.reportValidity()) return;

  const payload = buildReservationPayload();
  reservationMessage.textContent = "Préparation de la validation de votre séjour...";
  setStatus("neutral", "Connexion à la réservation sécurisée en cours.");

  try {
    const checkoutUrl = await createStripeCheckout(payload);
    window.location.href = checkoutUrl;
  } catch (error) {
    setStatus("warning", "La réservation en ligne doit encore être activée côté serveur.");
    reservationMessage.textContent = error.message;
  }
}

[guestsInput, cleaningInput, petsInput].forEach((input) => {
  input?.addEventListener("change", updateReservationSummary);
});

reservationForm?.addEventListener("submit", submitReservation);
renderCalendar();
loadAirbnbCalendar();
loadGoogleReviews();
