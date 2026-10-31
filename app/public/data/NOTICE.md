# Data notice

`places.json` holds 105 held-out decisions from 12 people in the New York release of Massive-STEPS
(CRUISEResearchGroup/Massive-STEPS-New-York on Hugging Face, Apache License 2.0), with the model's
scores on each decision. Massive-STEPS builds on the Semantic Trails dataset (CC0 1.0), and venue
names come from Foursquare Open Source Places (Apache License 2.0). User ids are replaced by
"Person 1" to "Person 12", private places carry no name, and no coordinates are included. Places that
reveal health, religion, sexual orientation, adult venues or a residence are shown only by a generic label
(for example "Health care" or "Place of worship"), with no venue name. The model's probabilities are
unchanged; only what is displayed is generalized.

`shopping.json` holds 62 held-out purchase decisions from 12 people in the Video Games category of
Amazon Reviews 2023 (McAuley Lab, released for research), with the model's scores on each decision.
It contains product titles, brands and categories only. Reviewer ids are replaced by "Person 1" to
"Person 12", and no review text, ratings, prices or times are included.
