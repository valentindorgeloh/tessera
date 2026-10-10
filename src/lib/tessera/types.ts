/**
 * Tessera shared types. Client-safe: types and enum unions only.
 * Row types for every table are added by the P1 engine lane next to the Drizzle schema
 * and re-exported from here.
 */
import type { z } from "zod";
import type {
  ActorKindSchema,
  CycleStatusSchema,
  EstimateTypeSchema,
  FavoriteEntityTypeSchema,
  IntakeSourceSchema,
  IntakeStatusSchema,
  LayoutSchema,
  ModuleStatusSchema,
  PageAccessSchema,
  PaletteColorSchema,
  PrioritySchema,
  RelationTypeSchema,
  StateGroupSchema,
  ViewSettingsScopeSchema,
} from "./schemas";

export type ActorKind = z.infer<typeof ActorKindSchema>;
export type StateGroup = z.infer<typeof StateGroupSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type ModuleStatus = z.infer<typeof ModuleStatusSchema>;
export type CycleStatus = z.infer<typeof CycleStatusSchema>;
export type RelationType = z.infer<typeof RelationTypeSchema>;
export type IntakeStatus = z.infer<typeof IntakeStatusSchema>;
export type IntakeSource = z.infer<typeof IntakeSourceSchema>;
export type EstimateType = z.infer<typeof EstimateTypeSchema>;
export type PaletteColor = z.infer<typeof PaletteColorSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type PageAccess = z.infer<typeof PageAccessSchema>;
export type ViewSettingsScope = z.infer<typeof ViewSettingsScopeSchema>;
export type FavoriteEntityType = z.infer<typeof FavoriteEntityTypeSchema>;

/** Error codes thrown by the service layer as TrackerError (docs/contracts/service-api.md). */
export type TrackerErrorCode = "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RULE" | "ARCHIVED" | "LOCKED" | "BUSY";

/** Human key of a work item, e.g. "WEB-12". */
export type WorkItemKey = `${string}-${number}`;
