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
Booleans, not their text equivalents. `Hevy Stats`
(`shortcut/lib/50-records.cherri`) builds each record as its own JSON
object and parses it with Get Dictionary from Input so the types
survive — Cherri's `setValue()` only stores text. Records are appended
to a real List with Add to Variable.

## Hevy Stats output

`Hevy Stats` returns a **List** of `RecordMetric` dictionaries by
default, one per metric:

| Form Name          | Metric Name                | Set Value from stats key           |
|--------------------|----------------------------|------------------------------------|
| Hevy - Muscle Group| `<muscle> working sets`    | `workingSetsPerMuscleGroup[muscle]`|
| Hevy - Muscle Group| `<muscle> volume`          | `volumeKgPerMuscleGroup[muscle]`   |
| Hevy - Exercise    | `<exercise> volume`        | `volumeKgPerExercise[exercise]`    |
| Hevy - Exercise    | `<exercise> 1RM`           | `oneRepMaxKgPerExercise[exercise]` |
| Hevy - Routine     | `<routine> working sets`   | `routineWorkingSets`               |
| Hevy - Routine     | `<routine> volume`         | `routineVolumeKg`                  |
| Hevy - Routine     | `<routine> duration`       | `routineDurationMinutes`           |

Notes:

- The `<routine> duration` record is emitted only when a duration is
  known (it is `null` when no matching workout has both timestamps).
  All other records are emitted whenever their source value exists.
- Names with `"` or `\` are JSON-escaped before the records are built.
- Record order: muscle groups, exercises, then routine totals.
- On a handled error the shortcut returns `{"_error", "_context"}`
  unchanged — it never fabricates metric records from an error.

## Raw stats output

Pass `"output_format": "stats"` in the input dictionary
(`{"api_key": "...", "output_format": "stats"}`) to get the raw stats
dictionary instead of the RecordMetric list:

```json
{
  "routineName": "Sample",
  "workingSetsPerMuscleGroup": {"chest": 3},
  "volumeKgPerExercise": {"Bench Press (Barbell)": 1646.5},
  "volumeKgPerMuscleGroup": {"chest": 1646.5},
  "oneRepMaxKgPerExercise": {"Bench Press (Barbell)": 69.9},
  "bodyWeightKgUsed": null,
  "routineWorkingSets": 6,
  "routineVolumeKg": 1646.5,
  "routineDurationMinutes": 0.3
}
```

This is the same dictionary the RecordMetric list is built from, and is
useful when composing Hevy Stats with other shortcuts via Run Shortcut.
