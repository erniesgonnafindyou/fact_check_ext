import { MISTRAL_API_KEY } from "./config.js";

const btn = document.getElementById("checkBtn");
const status = document.getElementById("status");
const tokenInfo = document.getElementById("token-info");
const output = document.getElementById("output");

btn.addEventListener("click", async () => {
  btn.disabled = true;
  status.textContent = "Pagina scannen...";
  tokenInfo.textContent = "";
  output.style.display = "none";
  output.classList.remove("error-box");
  output.textContent = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const [{ result: pageText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.slice(0, 3000)
    });

    if (!pageText || pageText.trim().length === 0) {
      status.textContent = "";
      output.style.display = "block";
      output.classList.add("error-box");
      output.textContent = "Geen leesbare tekst gevonden op deze pagina.";
      btn.disabled = false;
      return;
    }

    // Geschatte tokens berekenen en direct vasthouden
    const estimatedTokens = Math.ceil(pageText.length / 4);
    tokenInfo.textContent = `~${estimatedTokens} tokens`;
    status.textContent = "Mistral raadplegen...";

    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "open-mistral-7b", // 100% gratis beschikbaar op de Free Tier
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `Start je antwoord ALTIJD direct op regel 1 met exact één van deze drie labels:
- **Oordeel: BETROUWBAAR** (neutrale berichtgeving, claims sporen)
- **Oordeel: MET EEN KORREL ZOUT** (PR-spin, vage bronnen, selectieve weergave)
- **Oordeel: MISLEIDEND / ONBETROUWBAAR** (duidelijke desinformatie of feitelijke fouten)

Geef daaronder in maximaal 3 korte bullet points de reden.
Negeer context die al klopt. Focus puur op misleiding, cijferfouten of ongegronde aannames. Geen introducties of afsluitingen.`
          },
          {
            role: "user",
            content: `Hier is de paginatekst:\n\n${pageText}`
          }
        ]
      })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      const errorMsg = data.error?.message || data.message || JSON.stringify(data);
      status.textContent = "Fout";
      output.style.display = "block";
      output.classList.add("error-box");
      output.textContent = `API Fout (${res.status}): ${errorMsg}`;
      btn.disabled = false;
      return;
    }

    // Bij succes: vervang de schatting door de exacte telling
    status.textContent = "Klaar";
    if (data.usage) {
      tokenInfo.textContent = `${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} uit`;
    }

    output.style.display = "block";
    output.innerHTML = renderMarkdown(data.choices[0].message.content);

  } catch (err) {
    status.textContent = "Fout";
    output.style.display = "block";
    output.classList.add("error-box");
    output.textContent = `Fout: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

function renderMarkdown(md) {
  return md
    // Escape HTML tekens tegen injecties
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    // Bold & Cursief
    .replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/gim, "<em>$1</em>")
    // Horizontale lijnen
    .replace(/^---$/gim, "<hr>")
    // Bullet points (- of *)
    .replace(/^\s*[-*]\s+(.*$)/gim, "<li>$1</li>")
    // Paragrafen en enters (dubbele enter = witruimte)
    .replace(/\n\n+/g, "<br><br>")
    .replace(/\n/g, "<br>");
}