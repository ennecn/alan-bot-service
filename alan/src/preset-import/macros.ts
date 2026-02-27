/**
 * SillyTavern Template Macro Expansion
 *
 * Expands {{char}}, {{user}}, {{random}}, {{time}}, {{date}}, {{weekday}},
 * {{setvar}}, {{getvar}} macros found in preset content.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Expand ST template macros in text.
 * Called at assembly time with runtime context (char name, user name).
 */
export function expandMacros(text: string, charName: string, userName: string): string {
  let result = text;

  // Static replacements (case-insensitive)
  result = result.replace(/\{\{char\}\}/gi, charName);
  result = result.replace(/\{\{user\}\}/gi, userName);

  // Time/date macros — evaluated at call time
  result = result.replace(/\{\{time\}\}/gi, () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  });
  result = result.replace(/\{\{date\}\}/gi, () => {
    const now = new Date();
    return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });
  result = result.replace(/\{\{weekday\}\}/gi, () => {
    return WEEKDAYS[new Date().getDay()];
  });
  result = result.replace(/\{\{isotime\}\}/gi, () => new Date().toISOString());
  result = result.replace(/\{\{isodate\}\}/gi, () => new Date().toISOString().slice(0, 10));

  // {{random::a::b::c}} → pick one at random
  result = result.replace(/\{\{random::([^}]+)\}\}/gi, (_match, options: string) => {
    const choices = options.split('::');
    return choices[Math.floor(Math.random() * choices.length)];
  });

  // {{setvar::name::value}} → inline to value
  result = result.replace(/\{\{setvar::([^:}]+)::([^}]*)\}\}/gi, (_match, _name: string, value: string) => {
    return value;
  });

  // {{getvar::name}} → leave as {{name}} placeholder
  result = result.replace(/\{\{getvar::([^}]+)\}\}/gi, (_match, name: string) => {
    return `{{${name}}}`;
  });

  return result;
}
