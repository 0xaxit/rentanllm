import { redirect } from "next/navigation";

/** Agents moved into the Market page, under "Claude Desktop · MCP". */
const AgentsPage = () => {
  redirect("/market?use=mcp#use");
};

export default AgentsPage;
