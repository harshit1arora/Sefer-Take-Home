export function detectDocumentType(name: string) {
  if (/invoice/i.test(name)) return 'Commercial invoice';
  if (/pack/i.test(name)) return 'Packing list';
  // `\bbl\b` fails after an underscore ("House_BL.pdf"), so match BL as a standalone token between non-letters instead.
  if (/lading|(^|[^a-z])bl([^a-z]|$)|bill/i.test(name)) return 'Bill of lading';
  return 'Unclassified PDF';
}
export function isPdf(file: Pick<File, 'name' | 'type'>) { return /\.pdf$/i.test(file.name) && (!file.type || file.type === 'application/pdf'); }
