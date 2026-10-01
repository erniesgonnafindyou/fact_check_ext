import { Component, signal, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { API_KEY, API_MODEL, API_URL } from './config';
import { searchWeb } from './search';
import { tools } from './tools';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function renderMarkdown(md: string): string {
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

@Component({
  selector: 'app-root',
  imports: [],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private sanitizer = inject(DomSanitizer);

  isLoading = signal(false);
  status = signal('');
  tokenInfo = signal('');
  outputHtml = signal<SafeHtml>('');
  errorMsg = signal('');

  async checkPage() {
    this.isLoading.set(true);
    this.status.set('Pagina scannen...');
    this.tokenInfo.set('');
    this.outputHtml.set('');
    this.errorMsg.set('');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error("No active tab ID");

      const [{ result: pageText }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body.innerText.slice(0, 3000)
      });

      if (!pageText || pageText.trim().length === 0) {
        this.status.set('');
        this.errorMsg.set('Geen leesbare tekst gevonden op deze pagina.');
        this.isLoading.set(false);
        return;
      }

      let hostname = "";
      try {
        hostname = new URL(tab.url || "").hostname;
      } catch {
        hostname = tab.url || "";
      }

      let messages: any[] = [
        {
          role: "system",
          content: `Vandaag is het ${new Date().toLocaleDateString("nl-NL", { year: "numeric", month: "long" })}.
Je bent een meedogenloze factchecker.

Cruciale regels:
1. SANITY CHECK: Controleer absurde, onmogelijke of komische claims (zoals dieren die prijzen winnen, onmogelijke natuurwetten of overduidelijke verzinsels). Neem NIETS voor lief, ook niet als er echte namen (zoals artiesten of politici) omheen staan.
2. VERIFICATIE: Gebruik 'search_web' om verdachte claims, recente feiten of entiteiten te verifiëren. Als een zoekopdracht nog vragen openlaat, mag je een gerichte vervolgzoekopdracht doen. Stop zodra je genoeg bewijs hebt.
3. Als een kernclaim draait om een verzonnen figuur, dier of grap, oordeel dan ALTIJD:
- **Oordeel: MISLEIDEND / ONBETROUWBAAR** (of SATIRE)
4. BRONBEOORDELING: Weeg de reputatie van het domein/platform mee.
Als een beruchte desinformatiesite (zoals Natural News, Infowars) een legitieme studie aanhaalt, benoem dit dan expliciet: de specifieke claim kan kloppen, maar het platform zelf staat bekend om desinformatie en commerciële belangen.
Labels voor regel 1:
- **Oordeel: BETROUWBAAR**
- **Oordeel: MET EEN KORREL ZOUT**
- **Oordeel: MISLEIDEND / ONBETROUWBAAR**

Geef daaronder maximaal 3 korte bullet points waarin je de feiten of nonsens direct blootlegt.`
        },
        {
          role: "user",
          content: `Bron-domein: ${hostname}\nVolledige URL: ${tab.url}\n\nHier is de paginatekst:\n${pageText}`
        }
      ];

      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let responseMessage: any = null;

      const MAX_TOOL_ROUNDS = 2; // Veiligheidslimiet: max 3 zoekrondes
      let rounds = 0;

      while (rounds < MAX_TOOL_ROUNDS) {
        this.status.set(rounds === 0 
          ? "Mistral analyseert tekst..." 
          : `Zoekresultaten analyseren (ronde ${rounds + 1})...`);

        if (rounds > 0) {
          await sleep(2100);
        }

        let res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
          },
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            model: API_MODEL,
            messages: messages,
            tools: tools,
            tool_choice: "auto",
            temperature: 0.2
          })
        });

        let data = await res.json();

        if (!res.ok || data.error) {
          const errorMsg = data.error?.message || data.message || JSON.stringify(data);
          this.status.set("Fout");
          this.errorMsg.set(`API Fout (${res.status}): ${errorMsg}`);
          return;
        }

        if (data.usage) {
          totalPromptTokens += data.usage.prompt_tokens;
          totalCompletionTokens += data.usage.completion_tokens;
        }

        responseMessage = data.choices[0].message;

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          messages.push(responseMessage);

          for (const toolCall of responseMessage.tool_calls) {
            if (toolCall.function.name === "search_web") {
              const args = JSON.parse(toolCall.function.arguments);
              this.status.set(`Zoeken: "${args.query}"...`);

              const searchResult = await searchWeb(args.query);

              messages.push({
                role: "tool",
                name: "search_web",
                tool_call_id: toolCall.id,
                content: searchResult || "Geen resultaten gevonden."
              });
            }
          }
          rounds++;
        } else {
          break;
        }
      }

      if (!responseMessage.content || responseMessage.tool_calls) {
        this.status.set("Definitief oordeel formuleren...");
        let res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
          },
          body: JSON.stringify({
            model: API_MODEL,
            messages: messages,
            max_tokens: 1000,
            temperature: 0.2
          })
        });

        let data = await res.json();
        if (data.usage) {
          totalPromptTokens += data.usage.prompt_tokens;
          totalCompletionTokens += data.usage.completion_tokens;
        }
        responseMessage = data.choices[0].message;
      }

      this.status.set("Klaar");
      if (totalPromptTokens || totalCompletionTokens) {
        this.tokenInfo.set(`${totalPromptTokens} in / ${totalCompletionTokens} uit`);
      }

      const rawHtml = renderMarkdown(responseMessage.content || "");
      this.outputHtml.set(this.sanitizer.bypassSecurityTrustHtml(rawHtml));
      
    } catch (err: any) {
      this.status.set("Fout");
      this.errorMsg.set(`Fout: ${err.message}`);
    } finally {
      this.isLoading.set(false);
    }
  }
}
