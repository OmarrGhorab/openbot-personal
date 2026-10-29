import type { PluginGuide } from "./plugin-guide";

// Every statement about Figma here is taken from developers.figma.com and figma.com. Each page
// used is in `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const FIGMA_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Build a screen from a frame",
      text: "The get_design_context tool gets the design context and code for a layer or a selection. For a large selection, the get_metadata tool first gives a short XML outline. The agent can then ask for the parts it needs and write the screen in your project.",
    },
    {
      title: "Read the design tokens",
      text: "The get_variable_defs tool lists the variables and styles that a selection uses, such as colors, spacing and type. The get_code_connect_map tool returns the Code Connect mappings, so the agent uses your existing code components.",
    },
    {
      title: "Check the result visually",
      text: "The get_screenshot tool takes a screenshot of a selection. The agent can compare the design with the screen that it built, and find differences in layout or color before you review the change.",
    },
    {
      title: "Use FigJam and motion",
      text: "The get_figjam tool converts a FigJam diagram to XML, so an agent can read a flow or an architecture sketch. The get_motion_context tool gets keyframe animation data and code snippets for an animated layer.",
    },
  ],
  faq: [
    {
      question: "Does the Figma MCP server need an API key?",
      answer:
        "No. OpenBot connects to Figma's remote MCP server. Each user signs in to their own Figma account through the browser and approves the access. OpenBot does the sign-in itself and keeps the tokens in encrypted storage. The Figma desktop app does not need to run.",
    },
    {
      question: "Which Figma plan does the plugin need?",
      answer:
        "Figma limits tool calls by seat and plan. A Dev or Full seat on a Professional, Education, Organization, Government or Enterprise plan gets the most calls. For example, a Dev or Full seat on the Professional plan gets up to 200 calls a day and 10 a minute.",
    },
    {
      question: "Can an agent edit my Figma designs?",
      answer:
        "Yes, where Figma's remote server allows it. Figma says that writing to the canvas works only with its remote server, which this listing uses. Review each write before you approve it.",
    },
    {
      question: "Is the Figma MCP server official?",
      answer:
        "Yes. Figma makes the MCP server. This listing uses the remote server, which Figma recommends for most users. Figma also has a desktop server that runs in the Figma desktop app, which this listing does not use.",
    },
  ],
  sources: [
    { label: "Figma MCP server", url: "https://developers.figma.com/docs/figma-mcp-server/" },
    {
      label: "Figma MCP server: tools and prompts",
      url: "https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/",
    },
    {
      label: "Figma MCP server: desktop server installation",
      url: "https://developers.figma.com/docs/figma-mcp-server/local-server-installation/",
    },
    {
      label: "Figma MCP server: plans, access and rate limits",
      url: "https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/",
    },
  ],
  checkedAt: "2026-10-23",
};
