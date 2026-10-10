import type { Core } from '@strapi/strapi';

import { getConfig } from '../config';
import { fitUnits } from '../domain/text';

/** What a staff name is cut to, in UTF-16 units: the `maxLength` of a question's `staffName` and of an inquiry's `repliedBy`. */
const NAME_LENGTH = 100;

/**
 * The signed-in admin's first name: the name staff messages are signed with, cut to what the row holds without splitting
 * an emoji. Null makes the message speak for Maison's client advisor team: the admin has no first name, or it is the
 * house's own, "Maison" or either name in the config, in any case, which would have the message introduce Maison as one
 * of its own advisors and sign "Maison, Maison".
 */
export const staffNameOf = (strapi: Core.Strapi, ctx): string | null => {
  const firstname = ctx.state?.user?.firstname;
  const name = typeof firstname === 'string' ? firstname.trim() : '';
  if (!name) return null;
  const { houseName } = getConfig(strapi);
  const houseNames = ['Maison', houseName.en, houseName.ja].map((house) => house.trim().toLowerCase());
  return houseNames.includes(name.toLowerCase()) ? null : fitUnits(name, NAME_LENGTH);
};
