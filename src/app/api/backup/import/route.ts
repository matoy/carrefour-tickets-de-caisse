import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAuthenticated } from "@/lib/auth";
import {
  decodeAndValidateBackupBuffer,
  importDatabaseBackup,
  previewDatabaseBackup,
  type BackupImportMode,
} from "@/lib/db/backup-service";

export async function POST(request: NextRequest) {
  if (!isApiRequestAuthenticated(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    if (!fileEntry || typeof fileEntry === "string") {
      return NextResponse.json(
        { error: "Aucun fichier de sauvegarde fourni" },
        { status: 400 }
      );
    }

    const dryRun = String(formData.get("dryRun") ?? "false") === "true";
    const rawMode = String(formData.get("mode") ?? "merge");
    const mode: BackupImportMode = rawMode === "replace" ? "replace" : "merge";

    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let decoded: ReturnType<typeof decodeAndValidateBackupBuffer>;
    try {
      decoded = decodeAndValidateBackupBuffer(buffer);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Fichier de sauvegarde invalide",
        },
        { status: 400 }
      );
    }

    if (dryRun) {
      const preview = await previewDatabaseBackup(decoded.backup, {
        compressedBytes: decoded.compressedBytes,
        uncompressedBytes: decoded.uncompressedBytes,
      });
      return NextResponse.json({ ok: true, dryRun: true, preview });
    }

    const report = await importDatabaseBackup(decoded.backup, mode);
    return NextResponse.json({ ok: true, dryRun: false, report });
  } catch (err) {
    console.error("POST /api/backup/import error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erreur lors de l'import de la sauvegarde",
      },
      { status: 500 }
    );
  }
}
