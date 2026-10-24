import {
  SAMPLER_FIELD_META,
  fieldIsSent,
  type ConnectionKind,
  type SamplerFieldKey,
  type SamplerPreset,
} from "@rp/shared";
import { useEffect, useRef, useState } from "react";

const KIND_LABEL: Record<ConnectionKind, string> = {
  spacexai: "SpaceXAI",
  openai: "API",
  openai_extra: "API",
  ollama: "Ollama",
  kobold: "Kobold",
  mock: "Mock",
};

export function SamplerForm(props: {
  sampler: SamplerPreset;
  onChange: (sampler: SamplerPreset) => void;
  kind: ConnectionKind;
  extraSamplers: boolean;
  customText: string;
  onCustomText: (text: string, error: string | null) => void;
  section: "story" | "state";
}) {
  const groups = ["common", "dry", "ollama"] as const;
  return (
    <div data-sampler={props.section}>
      {groups.map((group) => (
        <section key={group}>
          <h3 className="group-title">{group === "dry" ? "DRY" : group === "ollama" ? "Ollama" : "Common"}</h3>
          {SAMPLER_FIELD_META.filter((field) => field.group === group).map((field) => {
            const sent = fieldIsSent(field, props.kind, props.extraSamplers);
            return (
              <div className={sent ? "sampler-row" : "sampler-row dim"} key={field.key}>
                <span>
                  {field.label}
                  {field.help ? <small style={{ display: "block", color: "var(--faint)" }}>{field.help}</small> : null}
                </span>
                <FieldControl field={field.key} widget={field.widget} step={field.step} sampler={props.sampler} onChange={props.onChange} />
                <div className="badge">{sent ? `Sends to ${field.sends.map((kind) => KIND_LABEL[kind]).filter((value, index, all) => all.indexOf(value) === index).join(" · ")}${field.sendsWhenExtra ? " · extra fields" : ""}` : "not sent to this backend"}</div>
              </div>
            );
          })}
        </section>
      ))}
      <h3 className="group-title">Custom JSON</h3>
      <p className="badge">Merged last. Invalid JSON blocks the send. Ollama root keys are think, keep_alive, format, logprobs, and top_logprobs. Other keys go into options.</p>
      <CustomBox text={props.customText} onText={props.onCustomText} />
    </div>
  );
}

function CustomBox(props: { text: string; onText: (text: string, error: string | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const next = validateCustom(props.text);
    setError(next);
  }, [props.text]);
  return (
    <label className="field">
      <textarea
        value={props.text}
        spellCheck={false}
        onChange={(event) => props.onText(event.target.value, validateCustom(event.target.value))}
      />
      {error ? <span style={{ color: "var(--danger)" }}>{error}</span> : <span>JSON object</span>}
    </label>
  );
}

export function validateCustom(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "Custom parameters must be a JSON object.";
    return null;
  } catch {
    return "Custom parameters are not valid JSON.";
  }
}

export function customFromText(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

function FieldControl(props: {
  field: SamplerFieldKey;
  widget: string;
  step?: number;
  sampler: SamplerPreset;
  onChange: (sampler: SamplerPreset) => void;
}) {
  const value = props.sampler[props.field];
  if (props.widget === "bool") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => props.onChange({ ...props.sampler, [props.field]: event.target.checked })}
      />
    );
  }
  if (props.widget === "think") {
    const current = value === null ? "default" : value ? "on" : "off";
    return (
      <select
        value={current}
        onChange={(event) => {
          const think = event.target.value === "default" ? null : event.target.value === "on";
          props.onChange({ ...props.sampler, think });
        }}
      >
        <option value="default">default</option>
        <option value="on">on</option>
        <option value="off">off</option>
      </select>
    );
  }
  if (props.widget === "lines" || props.widget === "ints") {
    return <LinesControl widget={props.widget} value={value} onCommit={(next) => props.onChange({ ...props.sampler, [props.field]: next })} />;
  }
  if (props.widget === "text") {
    return (
      <input
        value={String(value ?? "")}
        onChange={(event) => props.onChange({ ...props.sampler, [props.field]: event.target.value })}
      />
    );
  }
  return (
    <input
      type="number"
      step={props.step ?? 1}
      value={Number(value)}
      onChange={(event) => {
        const parsed = props.widget === "int" ? Number.parseInt(event.target.value, 10) : Number(event.target.value);
        if (Number.isNaN(parsed)) return;
        props.onChange({ ...props.sampler, [props.field]: parsed });
      }}
    />
  );
}

function formatLines(widget: string, value: string[] | number[]): string {
  return value.map(String).join(widget === "ints" ? ", " : "\n");
}

function parseLines(widget: string, text: string): string[] | number[] {
  if (widget === "ints") {
    return text.split(/[,\s]+/).filter(Boolean).map((item) => Number(item)).filter((item) => !Number.isNaN(item));
  }
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function LinesControl(props: { widget: string; value: unknown; onCommit: (value: string[] | number[]) => void }) {
  const initial = Array.isArray(props.value) ? formatLines(props.widget, props.value as string[] | number[]) : "";
  const [text, setText] = useState(initial);
  const echo = useRef(initial);
  useEffect(() => {
    if (initial === echo.current) return;
    echo.current = initial;
    setText(initial);
  }, [initial]);

  function commit(next: string) {
    const parsed = parseLines(props.widget, next);
    echo.current = formatLines(props.widget, parsed);
    props.onCommit(parsed);
  }

  return (
    <textarea
      rows={props.widget === "ints" ? 2 : 3}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        commit(next);
      }}
    />
  );
}
