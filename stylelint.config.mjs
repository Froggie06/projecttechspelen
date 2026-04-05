/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    "no-duplicate-selectors": true,     // zelfde selector 2x gebruiken verbieden
    "no-empty-source": true,            // lege CSS bestanden verbieden
    "selector-no-qualifying-type": true, // geen 'div.container', alleen '.container'
    "color-named": "never",               // geen kleurnamen gebruiken, alleen hex of rgb(a)
    "selector-id-pattern": null,            // toestaan van id selectors
  }
};
