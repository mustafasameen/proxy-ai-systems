# Data notice

`places.json` holds 105 held-out decisions from 12 people in the New York release of Massive-STEPS
(CRUISEResearchGroup/Massive-STEPS-New-York on Hugging Face, Apache License 2.0), with the model's
scores on each decision. Massive-STEPS builds on the Semantic Trails dataset (CC0 1.0), and venue
names come from Foursquare Open Source Places (Apache License 2.0). User ids are replaced by
"Person 1" to "Person 12" and private places carry no name. `places_geo.json` gives a location for each shown place, snapped
to a grid of about 500 m (0.0045 degrees of latitude by 0.006 degrees of longitude), never an exact venue position; places
shown by a generic label have no location. `nyc_boroughs.json` holds simplified borough outlines from the NYC Department of
City Planning, used to draw the map without any external map service. Places that
reveal health, religion, sexual orientation, adult venues or a residence are shown only by a generic label
(for example "Health care" or "Place of worship"), with no venue name. The model's probabilities are
unchanged; only what is displayed is generalized.

`shopping.json` holds 62 held-out purchase decisions from 12 people in the Video Games category of
Amazon Reviews 2023 (McAuley Lab, released for research), with the saved scores of the fine-tuned model on each decision
and the brand and category questions available for it. It contains product titles, brands and categories only. Reviewer ids are replaced by "Person 1" to
"Person 12", and no review text, ratings, prices or times are included.
