import { SEARCH_KEY, SEARCH_URL } from "./config";

// Eenvoudige zoekfunctie (bijv. met Tavily of Brave Search API)
export async function searchWeb(query: string) {
  // Voorbeeld met een gratis Tavily/Brave search fetch:
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: SEARCH_KEY, // 1.000 gratis calls/maand
      query: query,
      max_results: 3
    })
  });
  const data = await res.json();
  return data.results.map((r: any) => `${r.title}: ${r.content}`).join("\n\n");
};