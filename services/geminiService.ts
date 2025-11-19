
import { GoogleGenAI } from "@google/genai";
import { getAllMatches, getAllTeams } from "./storageService";
import { MatchSummaryData } from "../types";

export const generateLeagueReport = async (): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is not configured");
  }

  const ai = new GoogleGenAI({ apiKey });
  const [matches, teams] = await Promise.all([getAllMatches(), getAllTeams()]);
  
  const dataSummary: MatchSummaryData = {
    totalMatches: matches.length,
    teams: teams.map(t => ({ name: t.name, league: t.league })),
    recentMatches: matches.slice(0, 5).map(m => ({
        date: m.date,
        league: m.league,
        finished: m.isComplete
    }))
  };

  const prompt = `
    You are a professional baseball analyst for a youth hitting league.
    Here is the raw data for the league:
    ${JSON.stringify(dataSummary)}
    Please provide a brief, encouraging executive summary of the league's activity. 
    Focus on participation and the excitement of the 3v3 format.
    If there are no matches, encourage them to start the season.
    Keep it under 200 words.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    // Strictly accessing .text directly as per guidelines
    return response.text || "No report generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("Failed to generate report. Please check your configuration.");
  }
};