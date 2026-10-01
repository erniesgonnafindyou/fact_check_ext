export const tools = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Zoek actuele feiten, rapporten of nieuws op internet om claims te verifiëren.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "De specifieke zoekterm om bronnen over het onderwerp te vinden"
          }
        },
        required: ["query"]
      }
    }
  }
];