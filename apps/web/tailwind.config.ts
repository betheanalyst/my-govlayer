import type { Config } from "tailwindcss";

/**
 * GovLayer design tokens.
 *
 * The palette is deliberately restrained (Experience Blueprint section 19 /
 * "calm authority + intelligent clarity + human warmth"): a warm off-white
 * surface, near-black ink, one subtle indigo accent, and quiet semantic state
 * colours. State is never carried by colour alone -- every token is paired
 * with a label/icon at the component layer.
 *
 * `state.review.rejected` and `state.determination.failed` are deliberately
 * separate token families. The constitution distinguishes a constitutional
 * review outcome (`rejected`) from a post-vote governance outcome (`failed`),
 * and Non-Negotiable UX Requirement 2 forbids rendering them as the same kind
 * of outcome. Keeping them structurally distinct in the token layer makes that
 * distinction hard to lose later.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#FAF8F4",
          raised: "#FFFFFF",
          sunken: "#F2EFE9",
          inverse: "#14151A",
        },
        ink: {
          DEFAULT: "#14151A",
          muted: "#54575F",
          /**
           * Meta text. Chosen for WCAG AA on both the surface and sunken
           * backgrounds: the previous value sat at 3.7:1, below the 4.5:1
           * required for small text, and this one clears it on both.
           */
          subtle: "#64686F",
          inverse: "#FAF8F4",
        },
        line: {
          DEFAULT: "#E2DED6",
          strong: "#CFC9BE",
          /**
           * Boundaries of interactive controls only. WCAG 1.4.11 wants 3:1 for
           * the visual boundary that identifies a control, which the decorative
           * `line` tokens deliberately do not reach. Panels and dividers keep the
           * quieter tokens so the surface stays calm.
           */
          control: "#8A857A",
        },
        accent: {
          DEFAULT: "#33439B",
          strong: "#26327A",
          soft: "#E8EAF6",
        },
        state: {
          review: {
            accepted: "#2F6B4F",
            acceptedSoft: "#E7F0EA",
            revision: "#8A6A24",
            revisionSoft: "#F6EEDC",
            rejected: "#7A3B34",
            rejectedSoft: "#F6E7E4",
          },
          determination: {
            passed: "#2F6B4F",
            passedSoft: "#E7F0EA",
            failed: "#5C4033",
            failedSoft: "#EFE7E1",
            pending: "#33439B",
            pendingSoft: "#E8EAF6",
            cancelled: "#6B6E76",
            cancelledSoft: "#EDEBE7",
          },
          steward: {
            waitingApprovals: "#8A6A24",
            waitingApprovalsSoft: "#F6EEDC",
            timelocked: "#33439B",
            timelockedSoft: "#E8EAF6",
            ready: "#2F6B4F",
            readySoft: "#E7F0EA",
            executed: "#2F6B4F",
            executedSoft: "#E7F0EA",
            applied: "#2F6B4F",
            appliedSoft: "#E7F0EA",
            expired: "#6B6E76",
            expiredSoft: "#EDEBE7",
          },
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "0.625rem",
      },
      maxWidth: {
        prose: "68ch",
        shell: "78rem",
      },
      transitionDuration: {
        state: "180ms",
      },
    },
  },
  plugins: [],
};

export default config;
