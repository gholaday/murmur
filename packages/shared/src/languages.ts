// Languages as files and tracks name them: ISO 639-1 and 639-2 codes (both of 639-2's spellings)
// and English names. The app's JavaScript engine has no Intl.DisplayNames, so its names come from here too.

/** One ISO 639-2 code each, with the language's English name and the other codes it goes by. */
const LANGUAGES: Record<string, [name: string, ...codes: string[]]> = {
  ara: ["Arabic", "ar"],
  bul: ["Bulgarian", "bg"],
  cat: ["Catalan", "ca"],
  ces: ["Czech", "cs", "cze"],
  dan: ["Danish", "da"],
  deu: ["German", "de", "ger"],
  ell: ["Greek", "el", "gre"],
  eng: ["English", "en"],
  est: ["Estonian", "et"],
  eus: ["Basque", "eu", "baq"],
  fas: ["Persian", "fa", "per"],
  fin: ["Finnish", "fi"],
  fra: ["French", "fr", "fre"],
  gle: ["Irish", "ga"],
  glg: ["Galician", "gl"],
  heb: ["Hebrew", "he"],
  hin: ["Hindi", "hi"],
  hrv: ["Croatian", "hr"],
  hun: ["Hungarian", "hu"],
  ind: ["Indonesian", "id"],
  isl: ["Icelandic", "is", "ice"],
  ita: ["Italian", "it"],
  jpn: ["Japanese", "ja"],
  kor: ["Korean", "ko"],
  lav: ["Latvian", "lv"],
  lit: ["Lithuanian", "lt"],
  mkd: ["Macedonian", "mk", "mac"],
  msa: ["Malay", "ms", "may"],
  nld: ["Dutch", "nl", "dut"],
  nor: ["Norwegian", "no", "nb", "nob", "nn", "nno"],
  pol: ["Polish", "pl"],
  por: ["Portuguese", "pt"],
  ron: ["Romanian", "ro", "rum"],
  rus: ["Russian", "ru"],
  slk: ["Slovak", "sk", "slo"],
  slv: ["Slovenian", "sl"],
  spa: ["Spanish", "es"],
  srp: ["Serbian", "sr"],
  swe: ["Swedish", "sv"],
  tam: ["Tamil", "ta"],
  tel: ["Telugu", "te"],
  tha: ["Thai", "th"],
  tur: ["Turkish", "tr"],
  ukr: ["Ukrainian", "uk"],
  vie: ["Vietnamese", "vi"],
  yue: ["Cantonese"],
  zho: ["Chinese", "zh", "chi", "cmn"],
};

/** Every code and lower-case name, to its one code. */
const KNOWN = new Map<string, string>(
  Object.entries(LANGUAGES).flatMap(([code, [name, ...others]]) => [code, name.toLowerCase(), ...others].map((alias) => [alias, code] as const)),
);

const baseWord = (code: string) => code.toLowerCase().split(/[-_]/)[0]!;

/** "en", "eng" and "English" all give "eng"; a code it doesn't know comes back in lower case. */
export const subtitleLanguage = (code: string) => KNOWN.get(baseWord(code)) ?? baseWord(code);

/** Whether a word in a file name is a language, rather than a title or a tag. */
export const isLanguage = (word: string) => KNOWN.has(baseWord(word));

/** "English" for "eng" or "en"; null for a language this doesn't know. */
export const languageName = (code: string): string | null => LANGUAGES[subtitleLanguage(code)]?.[0] ?? null;
