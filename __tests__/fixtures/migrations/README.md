# Release migration fixtures

`main-3.7.3-schema31.sqlite.gz` is the supported release fixture. It was
created from `main@b4733454b17b37b0c25c63a4245b0fd7dd0e3dd5` (Cogmem 3.7.3,
schema 0031) and is used to verify the single formal 0032 upgrade.

```text
7907fcbffdcfd43f1b07f939fa9b773067434ffaedd64559eb1178a99398f79b  main-3.7.3-schema31.sqlite.gz
```

The older `3.5.2-real` and `f71b20a` files are archival evidence only.
3.7.4 development schemas and pre-3.7.3 releases are deliberately outside
the formal upgrade matrix; the runner rejects them instead of pretending
they executed the final 0032 migration.
