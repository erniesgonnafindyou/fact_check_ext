import { MISTRAL_API_KEY } from "./config.js";

const btn = document.getElementById("checkBtn");
const status = document.getElementById("status");
const output = document.getElementById("output");

btn.addEventListener("click", async () => {
  status.textContent = "Pagina analyseren...";
  output.textContent = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Haal de zichtbare tekst uit de actieve pagina
    const [{ result: pageText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.slice(0, 10000) // Eerste 10k tekens is ruim voldoende
    });

    if (!pageText || pageText.trim().length === 0) {
      status.textContent = "Geen tekst gevonden op deze pagina.";
      return;
    }

    status.textContent = "Mistral raadplegen...";

    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: "Je bent een feitelijke, kritische factchecker. Identificeer de centrale claims in de onderstaande paginatekst. Benoem direct eventuele misleidende statistieken, drogredenen of ontbrekende context. Wees beknopt en to-the-point."
          },
          {
            role: "user",
            content: `Hier is de inhoud van de pagina:\n\n${pageText}`
          }
        ]
      })
    });

    const data = await res.json();
    if (data.error) {
      status.textContent = `API Fout: ${data.error.message}`;
      return;
    }

    status.textContent = "Resultaat:";
    output.textContent = data.choices[0].message.content;
  } catch (err) {
    status.textContent = `Fout opgetreden: ${err.message}`;
  }
});