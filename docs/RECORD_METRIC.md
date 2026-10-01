# RecordMetric

The dictionary type consumed by the **Record Metrics** form. A
`RecordMetric` is a plain Dictionary with exactly these keys:

| Key              | Type    | Value                                              |
|------------------|---------|----------------------------------------------------|
| Form Name        | Text    | Which form the metric belongs to (see below)       |
| Metric Name      | Text    | `<subject> <metric>`, e.g. `chest working sets`    |
| Set Value        | Number  | The value to record                                |
| Increment        | Boolean | `false` — every record is an absolute set          |
| Decrement        | Boolean | `false`                                            |
| Reset            | Boolean | `false`                                            |
| Increment Amount | Text    | `""` (unused when Increment is false)              |

Example:

```json
{
  "Form Name": "Hevy - Exercise",
  "Metric Name": "Bench Press (Barbell) volume",
  "Set Value": 1646.5,
  "Increment": false,
  "Decrement": false,
  "Reset": false,
  "Increment Amount": ""
}
```

Types matter: `Set Value` must be a real Number and the flags real
Booleans, not their text equivalents. The wrapper
(`shortcut/hevy-record-metrics.cherri`) builds the records as JSON text
and parses them with Get Dictionary from Input so the types survive —
Cherri's `setValue()` only stores text.

## Hevy Record Metrics

`Hevy Record Metrics` (source: `shortcut/hevy-record-metrics.cherri`)
runs the **Hevy Stats** shortcut — passing Shortcut Input through
unchanged — and returns a **List** of `RecordMetric` dictionaries, one
per metric Hevy Stats reported:

| Form Name          | Metric Name                | Set Value from Hevy Stats key      |
|--------------------|----------------------------|------------------------------------|
| Hevy - Muscle Group| `<muscle> working sets`    | `workingSetsPerMuscleGroup[muscle]`|
| Hevy - Muscle Group| `<muscle> volume`          | `volumeKgPerMuscleGroup[muscle]`   |
| Hevy - Exercise    | `<exercise> volume`        | `volumeKgPerExercise[exercise]`    |
| Hevy - Exercise    | `<exercise> 1RM`           | `oneRepMaxKgPerExercise[exercise]` |
| Hevy - Routine     | `<routine> working sets`   | `routineWorkingSets`               |
| Hevy - Routine     | `<routine> volume`         | `routineVolumeKg`                  |
| Hevy - Routine     | `<routine> duration`       | `routineDurationMinutes`           |

Notes:

- The `<routine> duration` record is emitted only when Hevy Stats
  reports a duration (it is `null` when no matching workout has both
  timestamps). All other records are emitted whenever their source
  value exists.
- Names with `"` or `\` are JSON-escaped before the records are built.
- If Hevy Stats returns a handled error (`{"_error", "_context"}`),
  the wrapper returns that dictionary unchanged — it never fabricates
  metric records from an error.
- The wrapper calls Hevy Stats with Run Shortcut by its installed
  name, **Hevy Stats**. Both shortcuts must be installed; renaming
  Hevy Stats on the iPhone requires updating `@hevyStatsName` in the
  wrapper source and rebuilding.
- Hevy Stats' last action is always its result/error dictionary, so
  Run Shortcut deterministically receives a Dictionary.
