import { NextFunction, Response } from "express";
import { SystemRole } from "@prisma/client";
import { AuthRequest } from "./auth";

export function requireSystemRole(...roles: SystemRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth?.systemRole || !roles.includes(req.auth.systemRole))
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Akses global tidak diizinkan" },
      });
    return next();
  };
}
