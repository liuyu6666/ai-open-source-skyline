import { NextResponse } from "next/server";

import { getSkylineSnapshot } from "@/lib/skyline-data";

export const revalidate = 0;

export function GET() {
  return NextResponse.json(getSkylineSnapshot());
}

