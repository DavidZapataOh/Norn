/**
 * The full output of one recognition pass over fixtures/invoice_messy.png, a
 * phone photograph skewed 2.2 degrees with an uneven lighting gradient. Every
 * coordinate, string and confidence below is verbatim from that run, including
 * the two misreads: 'Jund' is the column header 'P.Unit', and ':%2 VAI' is
 * 'IVA 21%:' recovered backwards. The plate draws the document FROM this data,
 * so an annotation cannot drift away from the text it points at.
 */
export type Region = {
  conf: number;
  box: [number, number, number, number];
  text: string;
  field: string | null;
  state: 'ok' | 'abstained' | null;
  size: 'lg' | 'sm' | 'hd';
  /** Which margin the callout sits in. Declared rather than derived from x, so
   *  that rows close together do not stack their labels on the same side. */
  side?: 'left' | 'right';
};

export const recognised: Region[] = [
  { conf: 0.958, box: [101, 60, 468, 124], text: 'ACME CORP S.A', field: 'vendor', state: 'ok', size: 'lg' , side: 'left' },
  { conf: 0.769, box: [661, 84, 888, 133], text: 'FACTURA A', field: null, state: null, size: 'lg' },
  { conf: 0.720, box: [101, 117, 332, 154], text: 'CUIT 30-71234567-9', field: null, state: null, size: 'sm' },
  { conf: 0.978, box: [662, 138, 878, 176], text: 'N: 0001-00004471', field: null, state: null, size: 'sm' },
  { conf: 0.928, box: [659, 174, 879, 211], text: 'Fecha: 12/08/2026', field: null, state: null, size: 'sm' },
  { conf: 1.000, box: [97, 264, 240, 298], text: 'Descripcion', field: null, state: null, size: 'hd' },
  { conf: 1.000, box: [555, 280, 617, 309], text: 'Cant', field: null, state: null, size: 'hd' },
  { conf: 0.899, box: [678, 287, 754, 312], text: 'Jund', field: null, state: null, size: 'hd' },
  { conf: 0.999, box: [855, 293, 951, 325], text: 'Importe', field: null, state: null, size: 'hd' },
  { conf: 0.839, box: [93, 301, 416, 341], text: 'Servicio de consultoria tecnica', field: null, state: null, size: 'sm' },
  { conf: 1.000, box: [567, 322, 598, 346], text: '10', field: null, state: null, size: 'sm' },
  { conf: 0.998, box: [675, 324, 753, 355], text: '120,00', field: null, state: null, size: 'sm' },
  { conf: 0.990, box: [855, 331, 951, 362], text: '1.200,00', field: 'line_total', state: 'ok', size: 'sm' , side: 'right' },
  { conf: 0.890, box: [93, 348, 343, 382], text: 'Licencia software anual', field: null, state: null, size: 'sm' },
  { conf: 1.000, box: [564, 368, 579, 389], text: '2', field: null, state: null, size: 'sm' },
  { conf: 0.966, box: [672, 368, 751, 401], text: '450,00', field: null, state: null, size: 'sm' },
  { conf: 0.999, box: [853, 377, 930, 407], text: '900,00', field: null, state: null, size: 'sm' },
  { conf: 0.995, box: [92, 392, 371, 428], text: 'Soporte premium mensual', field: null, state: null, size: 'sm' },
  { conf: 1.000, box: [563, 412, 578, 433], text: '3', field: null, state: null, size: 'sm' },
  { conf: 0.997, box: [670, 414, 736, 446], text: '80,00', field: null, state: null, size: 'sm' },
  { conf: 0.629, box: [851, 423, 928, 451], text: '240,00', field: null, state: null, size: 'sm' },
  { conf: 1.000, box: [668, 501, 769, 529], text: 'Subtotal:', field: null, state: null, size: 'sm' },
  { conf: 0.996, box: [847, 506, 947, 539], text: '2.340,00', field: null, state: null, size: 'sm' },
  { conf: 0.849, box: [666, 542, 772, 570], text: ':%2 VAI', field: 'vat_rate', state: 'abstained', size: 'sm' , side: 'left' },
  { conf: 0.982, box: [844, 545, 924, 580], text: '491,40', field: null, state: null, size: 'sm' },
  { conf: 1.000, box: [663, 583, 781, 622], text: 'TOTAL:', field: null, state: null, size: 'lg' },
  { conf: 1.000, box: [824, 591, 1022, 635], text: 'ARS 2.831,40', field: 'invoice_total', state: 'ok', size: 'lg' , side: 'right' },
  { conf: 0.851, box: [81, 657, 448, 699], text: 'Orden de Compra: PO-2026-0912', field: null, state: null, size: 'sm' },
];

/** Cropped to the region the recogniser actually found text in. */
export const DOC_W = 1050;
export const DOC_H = 760;
