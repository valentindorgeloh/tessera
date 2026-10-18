"use client";

/**
 * Create, replace or edit an estimate system. Create and replace pick a type
 * and a template, then the values. Edit keeps the type and asks where items
 * of a removed point should go.
 */
import { useState, useTransition } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createEstimateAction, updateEstimateAction } from "@/app/actions/estimates";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { failureText } from "@/components/planning/archive-rules";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import { estimateValuesError } from "@/components/estimates/estimate-rules";
import { ESTIMATE_POINTS_MAX, ESTIMATE_TEMPLATES } from "@/lib/tessera/schemas";
import type { EstimateType, EstimateView } from "@/lib/tessera/types";
import { PlusIcon } from "@/themes/catppuccin/icons";

const NONE = "__none__";

const TYPES: readonly { value: EstimateType; label: string; description: string }[] = [
  { value: "points", label: "Points", description: "Numbers, lowest first, such as story points." },
  { value: "categories", label: "Categories", description: "Names in the order you want them shown, such as T-shirt sizes." },
  { value: "time", label: "Time", description: "Durations in minutes, shortest first." },
];

type PointDraft = { key: string; id?: string; value: string; description: string };

export type EstimateDialogProps = {
  projectId: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Edit keeps identities. Replace archives the current system. */
  mode: "create" | "replace" | "edit";
  estimate?: EstimateView;
};

export function EstimateDialog({ projectId, isOpen, onOpenChange, mode, estimate }: EstimateDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={560} aria-label={mode === "edit" ? "Edit estimate values" : "Estimate system"}>
      {isOpen ? <EstimateForm projectId={projectId} onOpenChange={onOpenChange} mode={mode} estimate={estimate} /> : null}
    </Dialog>
  );
}

function templatesFor(type: EstimateType) {
  return [...ESTIMATE_TEMPLATES.filter((template) => template.type === type && template.key !== "custom"), { key: "custom" as const, type, label: "Custom", values: ["", ""] }];
}

function fromEstimate(estimate: EstimateView): PointDraft[] {
  return estimate.points.map((point) => ({ key: point.id, id: point.id, value: point.value, description: point.description }));
}

function EstimateForm({ projectId, onOpenChange, mode, estimate }: Omit<EstimateDialogProps, "isOpen">) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const initialType = estimate?.type ?? "points";
  const [type, setType] = useState<EstimateType>(initialType);
  const [templateKey, setTemplateKey] = useState(mode === "edit" ? "custom" : "fibonacci");
  const [name, setName] = useState(estimate?.name ?? "Story points");
  const [points, setPoints] = useState<PointDraft[]>(() => (estimate && mode === "edit" ? fromEstimate(estimate) : templatesFor("points")[0].values.map((value, index) => ({ key: `new-${index}`, value, description: "" }))));
  const [remap, setRemap] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);

  const applyTemplate = (nextType: EstimateType, key: string) => {
    const template = templatesFor(nextType).find((item) => item.key === key) ?? templatesFor(nextType)[0];
    setTemplateKey(template.key);
    setPoints(template.values.map((value, index) => ({ key: `new-${index}-${template.key}`, value, description: "" })));
    if (mode !== "edit") setName(template.key === "custom" ? "" : template.label);
  };

  const valuesError = estimateValuesError(type, points.map((point) => point.value));
  const removed = mode === "edit" && estimate ? estimate.points.filter((point) => !points.some((draft) => draft.id === point.id)) : [];
  const keptOptions: SelectorOptionData[] = [
    { value: NONE, label: "No estimate" },
    ...points.filter((point) => point.id).map((point) => ({ value: point.id as string, label: formatEstimateValue(type, point.value) || "Value" })),
  ];

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= points.length) return;
    const next = [...points];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    setPoints(next);
  };

  const save = () => {
    if (valuesError || name.trim() === "") {
      setError(valuesError ?? "Name the estimate system");
      return;
    }
    setError(null);
    const payload = points.map((point) => ({
      ...(point.id ? { id: point.id } : {}),
      value: point.value.trim(),
      description: point.description,
    }));
    startTransition(async () => {
      const result =
        mode === "edit" && estimate
          ? await updateEstimateAction({
              estimate_id: estimate.id,
              name: name.trim(),
              points: payload,
              ...(removed.length > 0 ? { remap: Object.fromEntries(removed.map((point) => [point.id, remap[point.id] ?? null])) } : {}),
            })
          : await createEstimateAction({ project_id: projectId, name: name.trim(), type, points: payload.map(({ value, description }) => ({ value, description })) });
      if (!result.ok) {
        toast({ type: "error", body: failureText("Could not save the estimate system", result.message) });
        return;
      }
      toast({ type: "info", body: mode === "edit" ? "Updated the estimate system" : "Created the estimate system" });
      onOpenChange(false);
    });
  };

  return (
    <Layout
      header={<DialogHeader title={mode === "edit" ? "Edit values" : mode === "replace" ? "Replace estimate system" : "Create estimate system"} onOpenChange={onOpenChange} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            {mode === "replace" ? (
              <Banner status="warning" title="Replacing the estimate system" description="Items keep their value when the new system has the same value; others lose their estimate." />
            ) : null}
            {mode !== "edit" ? (
              <>
                <RadioList label="Type" value={type} onChange={(next) => { const typed = next as EstimateType; setType(typed); applyTemplate(typed, templatesFor(typed)[0].key); }}>
                  {TYPES.map((item) => (
                    <RadioListItem key={item.value} value={item.value} label={item.label} description={item.description} />
                  ))}
                </RadioList>
                <RadioList label="Template" value={templateKey} onChange={(next) => applyTemplate(type, next)}>
                  {templatesFor(type).map((template) => (
                    <RadioListItem key={template.key} value={template.key} label={template.label} description={template.values.filter(Boolean).map((value) => formatEstimateValue(type, value)).join(", ") || "Two blank values"} />
                  ))}
                </RadioList>
              </>
            ) : null}
            <TextInput label="Name" value={name} onChange={setName} />
            <VStack gap={2}>
              {points.map((point, index) => (
                <HStack key={point.key} gap={2} vAlign="end" className="tessera-estimate-row">
                  <TextInput label={index === 0 ? "Value" : `Value ${index + 1}`} isLabelHidden={index > 0} value={point.value} onChange={(value) => setPoints((rows) => rows.map((row) => (row.key === point.key ? { ...row, value } : row)))} className="tessera-estimate-value" />
                  <TextInput label={index === 0 ? "Description" : `Description ${index + 1}`} isLabelHidden={index > 0} value={point.description} onChange={(description) => setPoints((rows) => rows.map((row) => (row.key === point.key ? { ...row, description } : row)))} className="tessera-estimate-value" />
                  <MoreMenu
                    label={`Actions for value ${index + 1}`}
                    size="sm"
                    items={[
                      { id: "up", label: "Move up", isDisabled: index === 0, onClick: () => move(index, -1) },
                      { id: "down", label: "Move down", isDisabled: index === points.length - 1, onClick: () => move(index, 1) },
                      { id: "remove", label: "Remove", isDisabled: points.length <= 2, onClick: () => setPoints((rows) => rows.filter((row) => row.key !== point.key)) },
                    ]}
                  />
                </HStack>
              ))}
              <Button
                variant="ghost"
                size="sm"
                label="Add value"
                icon={<PlusIcon />}
                isDisabled={points.length >= ESTIMATE_POINTS_MAX}
                onClick={() => {
                  const key = `added-${added}`;
                  setAdded((count) => count + 1);
                  setPoints((rows) => [...rows, { key, value: "", description: "" }]);
                }}
              />
            </VStack>
            {removed.map((point) => (
              <Selector
                key={point.id}
                label={`Move items on ${formatEstimateValue(type, point.value)} to`}
                options={keptOptions.filter((option) => option.value !== point.id)}
                value={remap[point.id] ?? NONE}
                onChange={(next) => setRemap((current) => ({ ...current, [point.id]: next === NONE ? null : next }))}
              />
            ))}
            {error ? <FieldStatus type="error" message={error} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} />
            <Button variant="primary" label={mode === "edit" ? "Save" : "Create"} onClick={save} isLoading={isPending} isDisabled={name.trim() === "" || valuesError !== null} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
