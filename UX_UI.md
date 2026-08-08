# eWash UX/UI philosophy

This document is mandatory for every change that touches the user interface.
The goal is a calm, compact product in which the next action is obvious and
the user never has to decode the screen.

## Product principles

1. **Clarity before density.** Keep the interface compact, but never compress
   unrelated decisions into one surface. Group by user intent and reveal
   secondary detail only when it becomes relevant.
2. **One clear primary action.** Each page, modal, tab, or confirmation has one
   visually dominant next step. Secondary actions are ghost/text actions;
   destructive actions use the danger treatment and explicit confirmation.
3. **Recognition over recall.** Use plain labels, visible units, helpful
   defaults, and short contextual hints. Do not make users remember codes,
   workflows, or information shown on a previous screen.
4. **Progressive disclosure.** Put the common path first. Advanced settings,
   history, and rare actions belong in tabs, expandable regions, or a separate
   follow-up modal—not in the main task flow.
5. **Safe and reversible.** Explain consequences before sensitive actions.
   Preserve entered data after recoverable errors. Never expose secrets or let
   an administrator choose or see another user’s password.
6. **Consistent means learnable.** The same control, placement, wording, and
   feedback must represent the same behavior everywhere.

## Composition rules

- Search `web/src/components/` before adding markup. Extend an existing shared
  component when it is close; do not create view-specific copies.
- Use `BaseButton`, `FormField`, `AppSelect`, `ComboBox`, `Modal`,
  `ConfirmDialog`, `Panel`, `EmptyState`, `Skeleton`, `ToastHost`, `Avatar`,
  and `AppIcon` for their respective jobs.
- Use `AppSelect` for a bounded option list and `ComboBox` when users need to
  search a larger list. Native `<select>` elements and one-off dropdowns are
  not permitted in views.
- Icons come only from the `AppIcon` registry. An icon supports a text label;
  it does not replace one unless the action is universally understood and has
  an accessible name.
- Use only tokens from `web/src/style.css` for color, type, radius, surfaces,
  and shadows. The implemented tokens are the visual source of truth.

## Information hierarchy

- Start screens with a concise title, one-line purpose when needed, and the
  primary action. Avoid hero copy, decorative metrics, and repeated headings.
- Keep related fields in sections with short, concrete titles. Two columns are
  acceptable on desktop when fields are peers; stack them at 640px.
- Summaries answer “what is this?”; controls answer “what can I do next?” Do
  not mix configuration, history, and destructive actions in one undivided
  block.
- Tables and long lists are server-paginated and include loading, empty, and
  error states. Keep rows scannable and move row-specific detail into a
  standardized modal or detail surface.

## Modal standard

- A modal handles one task. If the content has distinct intents, use no more
  than a few clearly named tabs or split the workflow.
- Titles state the task; subtitles explain scope or consequence in one short
  sentence. Do not repeat the title inside the body.
- Use the shared `Modal` shell so header/footer remain fixed and only the body
  scrolls. Standard size is the default; `wide` and `workspace` require content
  that materially benefits from the width.
- Put stable context and status near the top, editable content in the body,
  and final actions in the footer. Cancel/Close comes before the primary
  action. Disable submission while busy and prevent accidental double actions.
- Confirmations name the action and its consequence. Destructive confirmation
  is reserved for irreversible or materially harmful changes; email sends and
  security changes still require clear, explicit wording.
- At mobile width, the shared modal becomes a bottom sheet. Fields and footer
  actions stack or stretch so the task remains usable at approximately 375px.

## Forms and feedback

- Labels are always visible. Placeholder text is an example, never the label.
- Ask only for information required now. Mark optional fields in the label or
  hint, validate at the boundary, and place specific errors near the relevant
  context. Toasts report request-level success or failure.
- Buttons use verbs that describe the result: “Save details,” “Send reset
  link,” or “Confirm email change,” not “Submit” or “OK.”
- Preserve focus, keyboard access, escape/close behavior, and meaningful ARIA
  labels. Never use browser `alert`, `confirm`, or `prompt` dialogs.
- Loading must not cause large layout shifts. Empty states explain what is
  absent and offer a next action only when one is useful.

## Default review checklist

- Is the primary task obvious within a few seconds?
- Can anything be removed, grouped, deferred, or renamed more plainly?
- Does it reuse the shared component and token system, including dropdowns?
- Are permissions enforced server-side and reflected in visible actions?
- Are loading, empty, error, success, disabled, and busy states covered?
- Is keyboard use sound, and is the layout usable at desktop and ~375px?
- For side effects such as email/SMS, were automated checks kept provider-free
  unless the user explicitly authorized real delivery?

