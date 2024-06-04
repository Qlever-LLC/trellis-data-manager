# Notes

Search is designed to setup and manage a particular master data type such as trading-partners

Two methods are exposed as job types:
-query - search for things
-ensure - query for an existing thing or else make a new one

The query method utilizes Fuse.js to fuzzy find things, but `sapid` and `masterid` are given special treatment. `sapid` is an id from an SAP-like external system while `masterid` is an internal trellis resource id for master data records.
-queries including `sapid` and/or `masterid` will attempt to find matches using those keys. Matches based on these keys will include `exact: true` in the result.
-If one of the two is included and matches on an entry (regardless of other keys), that entry will be returned.
-If both are included, both must match exactly on an entry in order for that entry to be returned.
-If both are included along with additonal search keys, but no `exact` matches are returned, it will fall back to a fuzzy search.
