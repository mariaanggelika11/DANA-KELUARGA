import type { RequestHandler, ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { WorkflowError } from "../modules/approvals/approval.rules";

const httpErrorCodes: Record<number, string> = {
  400: "INVALID_INPUT",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

export const normalizeErrorResponse: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === "object" &&
      body.error
    ) {
      body = {
        ...body,
        success: false,
        error: {
          code: httpErrorCodes[res.statusCode] ?? "REQUEST_FAILED",
          ...body.error,
        },
      };
    }
    return json(body);
  };
  next();
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  if (error instanceof WorkflowError)
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
  if (error instanceof ZodError)
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "Periksa kembali isian yang ditandai.",
        fields: error.issues.map((item) => ({
          field: item.path.join("."),
          message: /^[A-Z][a-z]+ (input|format)|^Too (small|big)|^Invalid/.test(
            item.message,
          )
            ? "Isian belum sesuai. Periksa format dan kelengkapannya."
            : item.message,
        })),
      },
    });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return res.status(409).json({
        success: false,
        error: {
          code: "DUPLICATE_DATA",
          message:
            "Data tersebut sudah digunakan atau sudah diproses. Periksa data sebelum mencoba lagi.",
        },
      });
    if (["P2025", "P2034"].includes(error.code))
      return res.status(409).json({
        success: false,
        error: {
          code: "DATA_CONFLICT",
          message:
            "Data berubah atau sudah diproses. Muat ulang dan coba lagi.",
        },
      });
    if (error.code === "P2023")
      return res.status(400).json({ error: { message: "ID tidak valid" } });
  }
  if (error instanceof SyntaxError)
    return res
      .status(400)
      .json({ error: { message: "Format JSON tidak valid" } });
  console.error(
    "Permintaan gagal",
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : "INTERNAL_ERROR",
  );
  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Permintaan belum dapat diproses. Silakan coba lagi.",
    },
  });
};
