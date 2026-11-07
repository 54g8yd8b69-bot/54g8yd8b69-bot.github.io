/* DentalAudit — audit templates
 * Starting points for common UK dental audits, in the v2 criterion shape.
 * Used by the Create Audit wizard ("Start from a template") and by the demo seed.
 * Targets are typical gold-standard values; edit them to match local policy.
 */
(function () {
  function c(name, description, reference, target, measurementMethod, numerator, denominator) {
    return { name: name, description: description, reference: reference, target: target, measurementMethod: measurementMethod, numerator: numerator, denominator: denominator };
  }

  const FGDP_RAD = 'FGDP(UK) Selection Criteria for Dental Radiography (2018); IR(ME)R 2017';
  const SDCEP = 'SDCEP Drug Prescribing for Dentistry (3rd edition)';
  const FGDP_REC = 'FGDP(UK) Clinical Examination and Record-Keeping (2016); GDC Standards 4.1';
  const BSP = 'BSP Basic Periodontal Examination guidance (2019)';
  const GDC_CONSENT = 'GDC Standards for the Dental Team, Principle 3; Montgomery v Lanarkshire (2015)';
  const ESE = 'ESE Quality Guidelines for Endodontic Treatment (2006); BES guidance';

  DA.templates = [
    {
      key: 'radiographs',
      title: 'Justification, grading and reporting of dental radiographs',
      specialty: 'Restorative Dentistry', department: 'Restorative Dentistry', projectType: 'Clinical Audit',
      background: 'Every exposure must be justified, quality-graded and clinically evaluated. Record reviews frequently find grading and written reports missing.',
      auditQuestion: 'Are intra-oral radiographs taken in the department justified, quality-graded and reported in line with IR(ME)R 2017?',
      aim: 'To ensure all dental radiographs are justified, graded and reported in the clinical record.',
      criteria: [
        c('Justification recorded', 'The clinical reason for each exposure is documented before it is taken.', FGDP_RAD, 100, 'Clinical record review', 'Radiographs with a documented justification', 'All radiographs taken in the sample period'),
        c('Quality grade recorded', 'Each image is graded as diagnostically acceptable or not acceptable.', FGDP_RAD, 100, 'Clinical record review', 'Radiographs with a recorded quality grade', 'All radiographs taken in the sample period'),
        c('Clinical evaluation recorded', 'A written report/evaluation of findings is documented in the notes.', FGDP_RAD, 100, 'Clinical record review', 'Radiographs with a documented clinical evaluation', 'All radiographs taken in the sample period'),
        c('Image diagnostically acceptable', 'Image graded "diagnostically acceptable" on independent review.', FGDP_RAD, 95, 'Radiograph review', 'Radiographs graded diagnostically acceptable', 'All radiographs reviewed')
      ]
    },
    {
      key: 'antimicrobial',
      title: 'Antimicrobial prescribing for acute dental conditions',
      specialty: 'General Dentistry', department: 'Unscheduled Care (Restorative A+E)', projectType: 'Clinical Audit',
      background: 'Antibiotics should only be prescribed for spreading infection or systemic involvement, alongside local measures, at the correct dose and duration.',
      auditQuestion: 'Are antibiotics prescribed in the unscheduled care clinic indicated, correctly dosed and accompanied by local measures?',
      aim: 'To ensure antimicrobial prescribing for acute dental conditions follows SDCEP guidance.',
      criteria: [
        c('Indication documented', 'Spreading infection or systemic involvement is recorded as the reason for prescribing.', SDCEP, 100, 'Clinical record review', 'Prescriptions with a documented SDCEP indication', 'All antibiotic prescriptions issued'),
        c('Drug, dose and frequency per SDCEP', 'First-line drug at the recommended dose and frequency.', SDCEP, 95, 'Clinical record review', 'Prescriptions matching SDCEP drug, dose and frequency', 'All antibiotic prescriptions issued'),
        c('Duration ≤ 5 days recorded', 'Course length documented and no longer than 5 days unless justified.', SDCEP, 95, 'Clinical record review', 'Prescriptions with a recorded duration of 5 days or fewer', 'All antibiotic prescriptions issued'),
        c('Local measures provided or planned', 'Drainage, extirpation or extraction carried out or arranged.', SDCEP, 100, 'Clinical record review', 'Cases with local measures provided or planned', 'All antibiotic prescriptions issued')
      ]
    },
    {
      key: 'medical-history',
      title: 'Medical history updated at each course of treatment',
      specialty: 'Restorative Dentistry', department: 'Restorative Dentistry', projectType: 'Clinical Audit',
      background: 'An up-to-date medical history is essential for safe care and is a frequent finding in record-keeping reviews.',
      auditQuestion: 'Is a complete, signed medical history recorded at the start of every course of treatment?',
      aim: 'To ensure the medical history is updated, complete and countersigned at every course of treatment.',
      criteria: [
        c('Medical history updated and signed', 'History updated and signed by the patient at the start of the course.', FGDP_REC, 100, 'Clinical record review', 'Courses with an updated, patient-signed history', 'All courses of treatment started in the sample period'),
        c('Current medications recorded', 'All current medications listed, or "none" recorded.', FGDP_REC, 100, 'Clinical record review', 'Histories with medications recorded', 'All courses of treatment audited'),
        c('Allergies recorded', 'Allergies recorded, including "no known allergies".', FGDP_REC, 100, 'Clinical record review', 'Histories with allergy status recorded', 'All courses of treatment audited'),
        c('Countersigned by clinician', 'Treating clinician has countersigned the history.', FGDP_REC, 100, 'Clinical record review', 'Histories countersigned by the clinician', 'All courses of treatment audited')
      ]
    },
    {
      key: 'bpe',
      title: 'BPE recording at new patient examination',
      specialty: 'Periodontics', department: 'Periodontology', projectType: 'Clinical Audit',
      background: 'BPE should be recorded for all sextants, with full periodontal charting where codes 3 or 4 are present.',
      auditQuestion: 'Is BPE recorded completely at new patient examinations, with appropriate charting for codes 3 and 4?',
      aim: 'To ensure periodontal screening is recorded and acted upon in line with BSP guidance.',
      criteria: [
        c('BPE recorded for all six sextants', 'A code (or X) is recorded for every sextant.', BSP, 90, 'Clinical record review', 'Examinations with all six sextants recorded', 'All new patient examinations audited'),
        c('BPE within previous 12 months', 'BPE date is within 12 months of the examination.', BSP, 90, 'Clinical record review', 'Patients with BPE recorded within 12 months', 'All new patient examinations audited'),
        c('Codes 3/4 followed by charting', 'Code 3: 6-point charting of that sextant; code 4: full charting.', BSP, 90, 'Clinical record review', 'Code 3/4 cases with appropriate charting', 'Patients with any BPE code 3 or 4'),
        c('Risk factors documented', 'Smoking status and diabetes status recorded.', BSP, 90, 'Clinical record review', 'Examinations with smoking and diabetes status recorded', 'All new patient examinations audited')
      ]
    },
    {
      key: 'consent',
      title: 'Valid consent documentation for dental extractions',
      specialty: 'Oral Surgery', department: 'Oral Surgery', projectType: 'Clinical Audit',
      background: 'Consent records must show that material risks, alternatives and the option of no treatment were discussed.',
      auditQuestion: 'Do consent records for extractions demonstrate valid, informed consent?',
      aim: 'To ensure consent for dental extractions is valid and fully documented.',
      criteria: [
        c('Signed consent form present', 'A completed, signed consent form is in the record.', GDC_CONSENT, 100, 'Clinical record review', 'Extractions with a signed consent form', 'All extractions in the sample period'),
        c('Material risks documented', 'Procedure-specific material risks are recorded.', GDC_CONSENT, 100, 'Clinical record review', 'Consent records documenting material risks', 'All extractions in the sample period'),
        c('Alternatives including no treatment documented', 'Alternatives and the option of no treatment were discussed.', GDC_CONSENT, 100, 'Clinical record review', 'Consent records documenting alternatives', 'All extractions in the sample period'),
        c('Opportunity to ask questions', 'Record shows the patient was invited to ask questions.', GDC_CONSENT, 100, 'Clinical record review', 'Consent records noting questions were invited', 'All extractions in the sample period')
      ]
    },
    {
      key: 'rubber-dam',
      title: 'Rubber dam use in endodontic treatment',
      specialty: 'Endodontics', department: 'Restorative Dentistry', projectType: 'Clinical Audit',
      background: 'Rubber dam isolation is the accepted standard of care for root canal treatment.',
      auditQuestion: 'Is rubber dam used and documented for every endodontic visit?',
      aim: 'To ensure rubber dam isolation is used and documented for all endodontic treatment.',
      criteria: [
        c('Rubber dam use recorded', 'Rubber dam use is documented for every endodontic visit.', ESE, 100, 'Clinical record review', 'Endodontic visits with rubber dam use recorded', 'All endodontic visits audited'),
        c('Reason documented where dam not used', 'Where dam was not used, the reason is recorded.', ESE, 100, 'Clinical record review', 'Visits without dam that record a reason', 'Endodontic visits where dam was not used'),
        c('Irrigant and concentration recorded', 'Irrigant type and concentration are documented.', ESE, 95, 'Clinical record review', 'Visits recording irrigant and concentration', 'All endodontic visits audited')
      ]
    },
    {
      key: 'implant-torque',
      title: 'Documentation of implant crown screw torque',
      specialty: 'Prosthodontics', department: 'Restorative Dentistry (Implants)', projectType: 'Clinical Audit',
      background: 'Recording the tightening torque of screw-retained implant restorations supports maintenance and the management of screw loosening.',
      auditQuestion: 'Is the tightening torque recorded when implant crowns are fitted?',
      aim: 'To ensure implant restoration torque and fit details are documented at every fit appointment.',
      criteria: [
        c('Appropriate documentation of implant crown torque', 'Implant crown tightening torque should be documented in the clinical record.', 'Local implant restorative protocol', 100, 'Clinical record review', 'Implant crown fits with torque value recorded', 'All implant crown fit appointments'),
        c('Screw access channel sealing recorded', 'Materials used to seal the screw access channel are recorded.', 'Local implant restorative protocol', 95, 'Clinical record review', 'Fits recording the access channel seal', 'All screw-retained implant crown fits'),
        c('Post-fit radiograph taken and reported', 'A periapical radiograph confirms seating and is reported.', 'Local implant restorative protocol', 95, 'Radiograph review', 'Fits with a reported post-fit radiograph', 'All implant crown fit appointments')
      ]
    }
  ];
})();
