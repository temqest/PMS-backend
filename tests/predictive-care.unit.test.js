const { test, expect, describe } = require('@jest/globals');
const {
  prescriptionRowsFromRecord,
  findCoverageGaps,
} = require('../src/api/v1/predictive-care/services/adherence.service');

describe('prescriptionRowsFromRecord', () => {
  test('parses prescription form variant (single medication)', () => {
    const rows = prescriptionRowsFromRecord({
      record_id: 'rx-form-1',
      details: {
        prescriptionMedicationName: 'Metformin',
        prescriptionStartDate: '2025-01-01',
        prescriptionEndDate: '2025-02-01',
        prescriptionQuantity: '60',
        prescriptionRefills: '2',
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].medicine_name).toBe('Metformin');
    expect(rows[0].quantity).toBe(60);
    expect(rows[0].refills).toBe(2);
  });

  test('parses multi-medicine prescription details', () => {
    const rows = prescriptionRowsFromRecord({
      record_id: 'rx-multi-1',
      details: {
        startDate: '2025-03-01',
        endDate: '2025-04-01',
        refills: 1,
        quantity: 30,
        medicines: [
          { medicineName: 'DrugA', prescribedQuantity: 30 },
          { medicineName: 'DrugB', prescribedQuantity: 60 },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.medicine_name).sort()).toEqual(['DrugA', 'DrugB']);
    expect(rows[0].record_id).toBe('rx-multi-1');
  });
});

describe('findCoverageGaps', () => {
  test('detects gap between sequential windows', () => {
    const gaps = findCoverageGaps([
      {
        record_id: 'a',
        start_date: new Date('2025-01-01'),
        end_date: new Date('2025-01-31'),
        quantity: 30,
        refills: 0,
      },
      {
        record_id: 'b',
        start_date: new Date('2025-02-15'),
        end_date: new Date('2025-03-15'),
        quantity: 30,
        refills: 0,
      },
    ]);
    expect(gaps.length).toBe(1);
    expect(gaps[0].gap_days).toBe(15);
  });
});
