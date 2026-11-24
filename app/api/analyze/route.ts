import { NextRequest } from "next/server";
import { handleAnalyzePost } from "@/lib/ai/analyzeRouteHelper";

export async function POST(request: NextRequest) {
  return handleAnalyzePost(request);
}
