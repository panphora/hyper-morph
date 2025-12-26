# HyperMatch Test Plan

100 tests organized by category. Tests marked with `[skip]` represent aspirational cases that may not pass — they map future direction while keeping the library minimal.

---

## Core Strengths (40 tests)

### Text Content Matching (10 tests)
1. Match elements by identical text content
2. Match elements with whitespace-normalized text
3. Reject match when text differs completely
4. Reject match when one has text, other empty
5. Match with long text (64+ chars, truncated hint)
6. Match list items by unique text
7. Match buttons by label text
8. Match headings by text content
9. Match links by link text
10. Match spans by text content

### Structural Path Matching (10 tests)
11. Match by position within same parent
12. Match after sibling insertion
13. Match after sibling removal
14. Match with landmark ancestor (main, nav, etc)
15. Match with id ancestor as landmark
16. Match with role attribute as landmark
17. Match deeply nested (4 levels)
18. Match when parent tag changes but path similar
19. Match nth-of-type correctly
20. Match across same-level reorder

### Signature Matching (10 tests)
21. Match by tag name alone (unique tag)
22. Match by tag + single class
23. Match by tag + multiple classes (order independent)
24. Match by tag + href attribute
25. Match by tag + src attribute
26. Match by tag + type attribute
27. Match by tag + role attribute
28. Match by tag + name attribute
29. Reject match when classes differ
30. Reject match when key attribute differs

### List Operations (10 tests)
31. Prepend single item to list
32. Prepend multiple items to list
33. Append single item to list
34. Append multiple items to list
35. Insert item in middle
36. Remove item from front
37. Remove item from middle
38. Remove item from end
39. Reverse entire list
40. Shuffle list (complex reorder)

---

## Advanced Scenarios (40 tests)

### Multi-Element Reorders (6 tests)
41. Swap two elements
42. Rotate three elements (A,B,C → C,A,B)
43. Move first to last
44. Move last to first
45. Interleave two lists
46. Random permutation (5 items)

### Cross-Container Movement (6 tests)
47. Move element to sibling container
48. Move element to nested container
49. Move element to parent container
50. Move multiple elements between containers
51. Swap elements between two containers
52. Move element across landmark boundary

### Partial Content Updates (6 tests)
53. Update text, keep structure
54. Update class, keep text
55. Update attribute, keep everything else
56. Add class to existing element
57. Remove class from element
58. Change href on matched link

### Similar Elements Disambiguation (6 tests)
59. Two divs, different classes
60. Two divs, different text
61. Two divs, different nested content
62. Three similar items, one unique
63. Greedy assignment (highest confidence first)
64. `[skip]` Tie-breaking by DOM order

### Deeply Nested DOM (10 tests)
65. Match element 4 levels deep
66. Match element 6 levels deep
67. Match element 8 levels deep
68. Reorder siblings at depth 4
69. Reorder siblings at depth 6
70. Insert element at depth 5
71. Remove element at depth 5
72. Move element between branches (same depth)
73. Nested cards inside sections inside main
74. `[skip]` Match element 10+ levels deep

### Nested Components (6 tests)
75. Card component (wrapper + header + body + footer)
76. Table with thead/tbody/rows/cells
77. Nested list (ul > li > ul > li)
78. Tree structure with expandable nodes
79. Accordion with nested content
80. `[skip]` Recursive component matching

---

## Edge Cases & Future Direction (20 tests)

### Challenging Scenarios (10 tests)
81. `[skip]` Identical elements (no distinguishing features)
82. `[skip]` Elements with only data-* attributes
83. `[skip]` Empty elements (no classes, no text)
84. `[skip]` Dynamic content (timestamps)
85. `[skip]` Counter values that change
86. Form inputs by value attribute
87. Form inputs by name attribute
88. Select elements with options
89. `[skip]` Textarea content matching
90. `[skip]` Contenteditable matching

### Special Elements (10 tests)
91. SVG elements
92. Image elements by src
93. Video/audio elements
94. `[skip]` iframe elements
95. `[skip]` Canvas elements
96. `[skip]` Custom elements (web components)
97. Links with fragments (#anchor)
98. Links with query params
99. `[skip]` Template element content
100. `[skip]` Slot element matching

---

## Summary

| Category | Total | Active | Skipped |
|----------|-------|--------|---------|
| Core Strengths | 40 | 40 | 0 |
| Advanced Scenarios | 40 | 37 | 3 |
| Edge Cases | 20 | 10 | 10 |
| **Total** | **100** | **87** | **13** |

### Skipped Tests Rationale

The 13 skipped tests represent:

1. **Complexity vs Value** — Features that add significant complexity for rare use cases
2. **Fundamental Limitations** — Cases where content-based matching can't help (identical elements)
3. **Future Exploration** — Features we may add if demand exists

The goal is to keep HyperMatch elegant and focused on the 80% case where it provides clear value.
