import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import { exportDatabaseBackup } from "@/lib/db/backup-service";

export async function GET(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const { gzipBuffer, fileName } = await exportDatabaseBackup();
    return new NextResponse(new Uint8Array(gzipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(gzipBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/backup/export error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de l'export de la base",
      },
      { status: 500 }
    );
  }
}
