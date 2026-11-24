# Parameters, equations and configurations

Read when a model must stay editable through named parameters, or when one design has variants (sizes, clearances, offsets). Working code: [cookbook.md](cookbook.md) (equations and configuration family recipes).

## Checklist

- Put each design quantity in one global variable and drive dimensions from it; name the dimension owner exactly in every equation target.
- Read back the stored equation text, the evaluated `Value` and the driven dimension after every equation change.
- Make variants configuration-specific values of the same variable, never copies of the model.
- Re-fetch the equation manager after every configuration change.
- Rebuild and check every configuration (errors, bodies, extents, a geometric witness) before export. `cad.ConfigurationReport()` returns errors, body count, suppressed-feature count and volume per configuration.
- Before adding features to a configured model, call `cad.ConfigurationsSuppressingNewItems()`. A configuration with "suppress new features" (on by default for some configurations) silently suppresses everything added while another configuration is active: no error code, and `FeatureErrors()` cannot see it. Switch it off with `cad.AllowNewItemsInAllConfigurations()`, or unsuppress afterwards, then confirm `cad.PartlySuppressedFeatures()` lists none of the new features. Assemblies have the same option for new components and mates.

## Equations

Name the owner in every equation target exactly. Sketch dimensions belong to the sketch (`"D3@SketchName"`) and feature dimensions to the feature (`"D1@Cut-Extrude1"`). A target naming the wrong owner can be accepted and drive a different dimension. After each addition, read back the stored text, `IEquationMgr.Value` and the target dimension.

Edit an existing equation through the indexed `Equation` setter and read the stored text back. Adding a second equation for an existing global variable does not modify it. Global variables can reference globals defined later in the list. `IIF(condition, a, b)` and `sqr()` (square root) evaluate in equations, which keeps derived offsets such as `T*sqr(2)` exact. Check the evaluated values. Sketch fillets created through `CreateFillet` add their own radius dimensions, and an equation on one of those can be flagged as an error. When a radius must follow a parameter, delete those dimensions in a sketch edit session, add fresh driving radius dimensions, then attach the equations.

## Configuration families

Drive a family of variants (clearances, board offsets, sizes) from one global variable whose value is configuration-specific. Do not maintain copies or independent per-configuration dimensions. For each configuration:

1. Activate it with `ShowConfiguration2`.
2. Fetch `GetEquationMgr()` again; it must be re-fetched after a configuration change.
3. Call `SetEquationAndConfigurationOption(index, text, swThisConfiguration, null)`.

On SOLIDWORKS 2025 this worked for globals created with `Add2`, despite the remark that only `Add3` equations are modifiable. Verify it: reactivate each configuration, rebuild, and read both the variable's `Value` and a geometric witness such as the body extent. Tie every dependent placement to the master variable, not just the obvious features: vents, ports, hole depths (`IIF` for thresholds) and reference planes. Before exporting, sample every configuration for rebuild errors, body count and envelope. Panels or covers that do not depend on the variable should stay configuration-free parts.

A linear pattern's spacing is not necessarily its `D1` dimension; one pattern exposed its spacing as `D3`. Identify the dimension by its current value or through the pattern definition before attaching an equation. After a parameter change, verify the instance positions. `AddConfiguration3` returns the new configuration object rather than a Boolean in this release. Check the returned object and the configuration name list instead of testing the return for truth.

## Assemblies that follow a variable

In the assembly, create matching configurations. While each one is active, set `IComponent2.ReferencedConfiguration` on the driven component. A layout or reference component that must follow the variable should be mated to a reference plane in the driven part whose offset is an equation, not fixed at a transform. Then verify each configuration's component transforms, mate errors and constraint status. Renaming the active configuration through `Configuration.Name` carried through to an open referencing assembly; verify the referenced configuration name afterwards.
