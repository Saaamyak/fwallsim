// Where each class PDF lives on the site. `npm run course` writes the PDFs to public/course/
// with these same names, and the app links to them, so the two can't drift apart.
import { LABS } from './labs';

/** The folder the PDFs are served from (public/course/ in the repo). */
export const COURSE_DIR = 'course';

/** File name of a class PDF: class number (two digits) + lab id, e.g. class-01-l1-basics.pdf. */
export const classFileName = (no: number, slug: string) => `class-${String(no).padStart(2, '0')}-${slug}.pdf`;

/** Class 00: the course plan. */
export const COURSE_PLAN_PDF = `/${COURSE_DIR}/${classFileName(0, 'course-plan')}`;

/** The class number for a lab (labs are taught in LABS order, starting at Class 1), or 0 if unknown. */
export const classNo = (labId: string) => LABS.findIndex((l) => l.id === labId) + 1;

/** The site path of the class PDF for a lab, e.g. /course/class-01-l1-basics.pdf. */
export function classPdf(labId: string): string | null {
  const no = classNo(labId);
  return no > 0 ? `/${COURSE_DIR}/${classFileName(no, labId)}` : null;
}
