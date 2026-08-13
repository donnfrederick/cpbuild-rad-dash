"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";

interface ColorToken {
  name: string;
  variable: string;
  value: string;
}

interface TypographyToken {
  name: string;
  sizeVariable: string;
  weightVariable: string;
  size: string;
  weight: string;
}

export function DesignSystemEditor() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [copied, setCopied] = useState(false);

  const [primaryColors, setPrimaryColors] = useState<ColorToken[]>([
    { name: "Primary / 700", variable: "--primary-700", value: "#1F3A5F" },
    { name: "Primary / 500", variable: "--primary-500", value: "#2E5C8A" },
    { name: "Primary / 100", variable: "--primary-100", value: "#E8F0F7" },
  ]);

  const [secondaryColors, setSecondaryColors] = useState<ColorToken[]>([
    { name: "Secondary / 700", variable: "--secondary-700", value: "#2F3B45" },
    { name: "Secondary / 500", variable: "--secondary-500", value: "#5C6B78" },
    { name: "Secondary / 100", variable: "--secondary-100", value: "#EEF2F5" },
  ]);

  const [neutralColors, setNeutralColors] = useState<ColorToken[]>([
    { name: "Neutral / 900", variable: "--neutral-900", value: "#1A1F24" },
    { name: "Neutral / 700", variable: "--neutral-700", value: "#3A434B" },
    { name: "Neutral / 500", variable: "--neutral-500", value: "#6E7781" },
    { name: "Neutral / 300", variable: "--neutral-300", value: "#C9D1D9" },
    { name: "Neutral / 100", variable: "--neutral-100", value: "#F4F6F8" },
    { name: "Neutral / 0",   variable: "--neutral-0",   value: "#FFFFFF"  },
  ]);

  const [feedbackColors, setFeedbackColors] = useState<ColorToken[]>([
    { name: "Success / 600", variable: "--success-600", value: "#1F7A4C" },
    { name: "Success / 100", variable: "--success-100", value: "#E6F4EC" },
    { name: "Warning / 600", variable: "--warning-600", value: "#B45309" },
    { name: "Warning / 100", variable: "--warning-100", value: "#FEF3C7" },
    { name: "Error / 600",   variable: "--error-600",   value: "#B42318" },
    { name: "Error / 100",   variable: "--error-100",   value: "#FEE4E2" },
  ]);

  const [typography, setTypography] = useState<TypographyToken[]>([
    { name: "Display",    sizeVariable: "--text-display",    weightVariable: "--font-weight-semibold", size: "32", weight: "600" },
    { name: "Heading",    sizeVariable: "--text-heading",    weightVariable: "--font-weight-semibold", size: "20", weight: "600" },
    { name: "Subheading", sizeVariable: "--text-subheading", weightVariable: "--font-weight-medium",   size: "16", weight: "500" },
    { name: "Body",       sizeVariable: "--text-body",       weightVariable: "--font-weight-normal",   size: "14", weight: "400" },
    { name: "Caption",    sizeVariable: "--text-caption",    weightVariable: "--font-weight-medium",   size: "12", weight: "500" },
  ]);

  useEffect(() => {
    const root = document.documentElement;
    [...primaryColors, ...secondaryColors, ...neutralColors, ...feedbackColors].forEach(
      (color) => {
        // Neutral palette edits are light-mode defaults — don't override .dark remapping.
        if (isDark && color.variable.startsWith("--neutral-")) {
          root.style.removeProperty(color.variable);
          return;
        }
        root.style.setProperty(color.variable, color.value);
      }
    );
    typography.forEach((type) => {
      root.style.setProperty(type.sizeVariable, `${type.size}px`);
      root.style.setProperty(type.weightVariable, type.weight);
    });
  }, [primaryColors, secondaryColors, neutralColors, feedbackColors, typography, isDark]);

  const updateColor = (
    setter: React.Dispatch<React.SetStateAction<ColorToken[]>>,
    index: number,
    value: string
  ) => {
    setter((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], value };
      return updated;
    });
  };

  const updateTypography = (index: number, field: "size" | "weight", value: string) => {
    setTypography((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const generateCSS = () => {
    let css = `:root {\n  /* Rad Dash Design System */\n  \n  /* Font Configuration */\n  --font-size: 16px;\n  \n`;
    css += `  /* Primary Tokens */\n`;
    primaryColors.forEach((c) => { css += `  ${c.variable}: ${c.value};\n`; });
    css += `  \n  /* Secondary Tokens */\n`;
    secondaryColors.forEach((c) => { css += `  ${c.variable}: ${c.value};\n`; });
    css += `  \n  /* Neutral Tokens */\n`;
    neutralColors.forEach((c) => { css += `  ${c.variable}: ${c.value};\n`; });
    css += `  \n  /* Feedback Tokens */\n`;
    feedbackColors.forEach((c) => { css += `  ${c.variable}: ${c.value};\n`; });
    css += `  \n  /* Type Scale */\n`;
    typography.forEach((t) => { css += `  ${t.sizeVariable}: ${t.size}px;\n`; });
    css += `  \n  /* Font Weights */\n`;
    css += `  --font-weight-semibold: 600;\n`;
    css += `  --font-weight-medium: 500;\n`;
    css += `  --font-weight-normal: 400;\n`;
    css += `}\n`;
    return css;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generateCSS());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex items-center justify-between flex-shrink-0 border-b"
        style={{
          padding: "var(--space-3) var(--space-4)",
          borderColor: "var(--border)",
          backgroundColor: "var(--card)",
        }}
      >
        <p style={{ fontSize: "var(--text-caption)", fontWeight: "var(--font-weight-medium)", color: "var(--muted-foreground)" }}>
          App appearance
        </p>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="flex items-center gap-2 transition-colors duration-150"
          style={{
            padding: "6px var(--space-3)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--muted)",
            color: "var(--foreground)",
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold)",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
          aria-pressed={isDark}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
          {isDark ? "Light Mode" : "Dark Mode"}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
      {/* ── Editor panel ── */}
      <div className="flex-1 overflow-auto bg-background" style={{ padding: "var(--space-4)" }}>
        <div className="flex flex-col gap-6 md:gap-8">

          {/* Color Tokens */}
          <section>
            <h3
              className="mb-4"
              style={{ fontSize: "var(--text-heading)", fontWeight: "var(--font-weight-semibold)", color: "var(--foreground)" }}
            >
              Color Tokens
            </h3>

            {[
              { label: "Primary",   tokens: primaryColors,   setter: setPrimaryColors   },
              { label: "Secondary", tokens: secondaryColors, setter: setSecondaryColors },
              { label: "Neutrals",  tokens: neutralColors,   setter: setNeutralColors   },
              { label: "Feedback",  tokens: feedbackColors,  setter: setFeedbackColors  },
            ].map(({ label, tokens, setter }, groupIdx) => (
              <div
                key={label}
                className={groupIdx < 3 ? "mb-4 md:mb-6" : undefined}
                style={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-4)",
                }}
              >
                <h4
                  className="mb-4"
                  style={{ fontSize: "var(--text-subheading)", fontWeight: "var(--font-weight-medium)", color: "var(--foreground)" }}
                >
                  {label}
                </h4>
                <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                  {tokens.map((color, index) => (
                    <ColorInput
                      key={color.variable}
                      name={color.name}
                      value={color.value}
                      onChange={(value) => updateColor(setter, index, value)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* Typography Scale */}
          <section>
            <h3
              className="mb-4"
              style={{ fontSize: "var(--text-heading)", fontWeight: "var(--font-weight-semibold)", color: "var(--foreground)" }}
            >
              Typography Scale
            </h3>
            <div
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-4)",
              }}
            >
              <div className="flex flex-col gap-4">
                {typography.map((type, index) => (
                  <TypographyInput
                    key={type.name}
                    name={type.name}
                    size={type.size}
                    weight={type.weight}
                    onSizeChange={(value) => updateTypography(index, "size", value)}
                    onWeightChange={(value) => updateTypography(index, "weight", value)}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Instructions */}
          <section>
            <div
              style={{
                backgroundColor: isDark ? "rgba(124, 58, 237, 0.15)" : "#F3E8FF",
                border: "1px solid var(--dev-purple, #7C3AED)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-4)",
              }}
            >
              <h4
                className="mb-2"
                style={{
                  fontSize: "var(--text-subheading)",
                  fontWeight: "var(--font-weight-semibold)",
                  color: isDark ? "#C4B5FD" : "#6B21A8",
                }}
              >
                How to Apply Changes
              </h4>
              <ol
                style={{
                  fontSize: "var(--text-body)",
                  color: isDark ? "#DDD6FE" : "#6B21A8",
                  paddingLeft: "var(--space-4)",
                }}
              >
                <li>Adjust colors and typography above — changes apply live.</li>
                <li>Click &quot;Copy CSS&quot; to copy the generated :root block.</li>
                <li>Paste into <code>app/globals.css</code> to make changes permanent.</li>
              </ol>
            </div>
          </section>
        </div>
      </div>

      {/* ── Live Preview panel ── */}
      <div
        className="flex flex-col flex-shrink-0"
        style={{
          width: "280px",
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--background)",
        }}
      >
        <div
          className="border-b flex items-center justify-between"
          style={{
            padding: "var(--space-4)",
            borderColor: "var(--border)",
            backgroundColor: "var(--card)",
          }}
        >
          <h4 style={{ fontSize: "var(--text-subheading)", fontWeight: "var(--font-weight-semibold)", color: "var(--foreground)" }}>
            Live Preview
          </h4>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1 transition-colors duration-150"
            style={{
              padding: "4px var(--space-3)",
              borderRadius: "var(--radius-sm)",
              backgroundColor: copied ? "var(--success-100)" : "var(--muted)",
              color: copied ? "var(--success-600)" : "var(--foreground)",
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-medium)",
              border: `1px solid ${copied ? "var(--success-600)" : "var(--border)"}`,
              cursor: "pointer",
            }}
          >
            {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy CSS</>}
          </button>
        </div>

        <div className="flex-1 overflow-auto" style={{ padding: "var(--space-4)" }}>
          <div className="flex flex-col gap-4">
            <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)" }}>
              <p className="mb-2" style={{ fontSize: "var(--text-caption)", fontWeight: "var(--font-weight-medium)", color: "var(--muted-foreground)" }}>
                PRIMARY COLORS
              </p>
              <div className="flex gap-2">
                {primaryColors.map((color) => (
                  <div
                    key={color.variable}
                    title={color.name}
                    style={{
                      width: "48px",
                      height: "48px",
                      backgroundColor: color.value,
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border)",
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)" }}>
              <p className="mb-2" style={{ fontSize: "var(--text-caption)", fontWeight: "var(--font-weight-medium)", color: "var(--muted-foreground)" }}>
                TYPOGRAPHY
              </p>
              <div className="flex flex-col gap-2">
                <h1 style={{ color: "var(--foreground)" }}>Display Text</h1>
                <h2 style={{ color: "var(--foreground)" }}>Heading Text</h2>
                <h3 style={{ color: "var(--foreground)" }}>Subheading Text</h3>
                <p style={{ color: "var(--foreground)" }}>Body text for regular content</p>
                <p style={{ fontSize: "var(--text-caption)", color: "var(--muted-foreground)" }}>Caption text</p>
              </div>
            </div>

            <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", padding: "var(--space-3)", borderRadius: "var(--radius-sm)" }}>
              <p className="mb-2" style={{ fontSize: "var(--text-caption)", fontWeight: "var(--font-weight-medium)", color: "var(--muted-foreground)" }}>
                BUTTONS
              </p>
              <div className="flex flex-col gap-2">
                <button
                  style={{
                    padding: "0 var(--space-4)",
                    height: "var(--button-height)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--primary-500)",
                    color: "#F4F6F8",
                    fontSize: "var(--text-body)",
                    fontWeight: "var(--font-weight-semibold)",
                    border: "none",
                    cursor: "default",
                  }}
                >
                  Primary Button
                </button>
                <button
                  style={{
                    padding: "0 var(--space-4)",
                    height: "var(--button-height)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "transparent",
                    border: "1px solid var(--border)",
                    color: "var(--foreground)",
                    fontSize: "var(--text-body)",
                    fontWeight: "var(--font-weight-semibold)",
                    cursor: "default",
                  }}
                >
                  Secondary Button
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function ColorInput({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label style={{ fontSize: "var(--text-caption)", fontWeight: "var(--font-weight-medium)", color: "var(--muted-foreground)" }}>
        {name}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "48px",
            height: "var(--input-height)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            padding: "2px",
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 outline-none"
          style={{
            height: "var(--input-height)",
            padding: "0 var(--space-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
            fontSize: "var(--text-body)",
            fontFamily: "monospace",
          }}
        />
      </div>
    </div>
  );
}

function TypographyInput({
  name, size, weight, onSizeChange, onWeightChange,
}: {
  name: string; size: string; weight: string;
  onSizeChange: (v: string) => void; onWeightChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div style={{ width: "120px" }}>
        <p style={{ fontSize: "var(--text-body)", fontWeight: "var(--font-weight-medium)", color: "var(--foreground)" }}>{name}</p>
      </div>
      <div className="flex-1 flex gap-4">
        <div className="flex-1">
          <label style={{ fontSize: "var(--text-caption)", fontWeight: "var(--font-weight-medium)", color: "var(--muted-foreground)" }}>
            Size (px)
          </label>
          <input
            type="number"
            value={size}
            onChange={(e) => onSizeChange(e.target.value)}
            className="w-full outline-none"
            style={{
              height: "var(--input-height)",
              padding: "0 var(--space-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              fontSize: "var(--text-body)",
              marginTop: "var(--space-1)",
            }}
          />
        </div>
        <div className="flex-1">
          <label style={{ fontSize: "var(--text-caption)", fontWeight: "var(--font-weight-medium)", color: "var(--muted-foreground)" }}>
            Weight
          </label>
          <select
            value={weight}
            onChange={(e) => onWeightChange(e.target.value)}
            className="w-full outline-none"
            style={{
              height: "var(--input-height)",
              padding: "0 var(--space-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              fontSize: "var(--text-body)",
              marginTop: "var(--space-1)",
            }}
          >
            <option value="400">Regular (400)</option>
            <option value="500">Medium (500)</option>
            <option value="600">Semibold (600)</option>
            <option value="700">Bold (700)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
